import type { Pool } from 'pg';
import { logger } from '../lib/logger.js';
import { newId } from '../lib/ids.js';
import { NotFoundError, ForbiddenError } from '../lib/errors.js';

export interface TranscriptServiceDeps {
  pool: Pool;
}

export type SpeakerRole = 'candidate' | 'interviewer' | 'system';

export interface AppendSegmentParams {
  meetingId: string;
  speakerUserId: string | null;
  speakerRole: SpeakerRole;
  text: string;
  startedAt: Date;
  endedAt: Date;
  isFinal: boolean;
  confidence: number | null;
}

export interface SegmentRow {
  id: string;
  meetingId: string;
  seq: number;
  speakerUserId: string | null;
  speakerRole: SpeakerRole;
  text: string;
  startedAt: Date;
  endedAt: Date;
  isFinal: boolean;
  confidence: number | null;
  createdAt: Date;
}

export interface AddNoteParams {
  meetingId: string;
  anchorSegmentId: string | null;
  authorUserId: string;
  body: string;
}

export interface NoteRow {
  id: string;
  meetingId: string;
  anchorSegmentId: string | null;
  authorUserId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

export class TranscriptService {
  private readonly seqCounters = new Map<string, number>();

  constructor(private readonly deps: TranscriptServiceDeps) {}

  /**
   * Appends a Deepgram segment (interim or final).
   * Seq is assigned from an in-memory counter keyed by meetingId, hydrated from
   * MAX(seq) on the first append for a given meeting. No DB lock required —
   * Deepgram streams one segment at a time per meeting, so concurrent appends
   * for the same meeting are not expected. If the INSERT fails, the counter is
   * rolled back so the next call does not skip a seq.
   */
  async appendSegment(params: AppendSegmentParams): Promise<{ id: string; seq: number }> {
    if (!this.seqCounters.has(params.meetingId)) {
      const { rows } = await this.deps.pool.query<{ max_seq: number }>(
        `SELECT COALESCE(MAX(seq), 0) AS max_seq
           FROM transcript_segments
          WHERE meeting_id = $1`,
        [params.meetingId],
      );
      this.seqCounters.set(params.meetingId, rows[0]!.max_seq);
    }

    const seq = this.seqCounters.get(params.meetingId)! + 1;
    this.seqCounters.set(params.meetingId, seq);
    const id = newId();

    try {
      await this.deps.pool.query(
        `INSERT INTO transcript_segments
           (id, meeting_id, seq, speaker_user_id, speaker_role,
            text, started_at, ended_at, is_final, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id, params.meetingId, seq, params.speakerUserId, params.speakerRole,
          params.text, params.startedAt, params.endedAt, params.isFinal, params.confidence,
        ],
      );
    } catch (err) {
      this.seqCounters.set(params.meetingId, seq - 1);
      throw err;
    }

    logger.debug({ meetingId: params.meetingId, seq, isFinal: params.isFinal }, 'segment appended');
    return { id, seq };
  }

  /** Evicts the seq counter for a meeting. Called by MeetingService on endMeeting. */
  clearSeqCounter(meetingId: string): void {
    this.seqCounters.delete(meetingId);
  }

  /**
   * Returns segments in seq order.
   * afterSeq is exclusive — pass the last seq seen for cursor-based pagination.
   * Uses idx_transcript_segments_meeting_seq.
   */
  async getSegments(
    meetingId: string,
    afterSeq = 0,
    limit = 100,
  ): Promise<SegmentRow[]> {
    const { rows } = await this.deps.pool.query<{
      id: string;
      meeting_id: string;
      seq: number;
      speaker_user_id: string | null;
      speaker_role: SpeakerRole;
      text: string;
      started_at: Date;
      ended_at: Date;
      is_final: boolean;
      confidence: number | null;
      created_at: Date;
    }>(
      `SELECT id, meeting_id, seq, speaker_user_id, speaker_role,
              text, started_at, ended_at, is_final, confidence, created_at
         FROM transcript_segments
        WHERE meeting_id = $1 AND seq > $2
        ORDER BY seq
        LIMIT $3`,
      [meetingId, afterSeq, limit],
    );

    return rows.map((r) => ({
      id: r.id,
      meetingId: r.meeting_id,
      seq: r.seq,
      speakerUserId: r.speaker_user_id,
      speakerRole: r.speaker_role,
      text: r.text,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      isFinal: r.is_final,
      confidence: r.confidence,
      createdAt: r.created_at,
    }));
  }

  /** Returns all notes for a meeting in creation order. */
  async getNotes(meetingId: string): Promise<NoteRow[]> {
    const { rows } = await this.deps.pool.query<{
      id: string;
      meeting_id: string;
      anchor_segment_id: string | null;
      author_user_id: string;
      body: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, meeting_id, anchor_segment_id, author_user_id, body, created_at, updated_at
         FROM transcript_notes
        WHERE meeting_id = $1
        ORDER BY created_at`,
      [meetingId],
    );
    return rows.map((r) => ({
      id:              r.id,
      meetingId:       r.meeting_id,
      anchorSegmentId: r.anchor_segment_id,
      authorUserId:    r.author_user_id,
      body:            r.body,
      createdAt:       r.created_at,
      updatedAt:       r.updated_at,
    }));
  }

  /**
   * Adds an interviewer note, optionally anchored to a segment.
   * Validates that anchorSegmentId, if given, belongs to the same meeting.
   * Interviewer corrections are expressed as notes — segments are never mutated.
   * Returns the full NoteRow so callers can broadcast without a second read.
   */
  async addNote(params: AddNoteParams): Promise<NoteRow> {
    if (params.anchorSegmentId !== null) {
      const { rows } = await this.deps.pool.query<{ id: string }>(
        `SELECT id FROM transcript_segments WHERE id = $1 AND meeting_id = $2`,
        [params.anchorSegmentId, params.meetingId],
      );
      if (!rows[0]) {
        throw new NotFoundError(
          `Segment ${params.anchorSegmentId} not found in meeting ${params.meetingId}`,
        );
      }
    }

    const id = newId();
    const { rows } = await this.deps.pool.query<{ created_at: Date; updated_at: Date }>(
      `INSERT INTO transcript_notes (id, meeting_id, anchor_segment_id, author_user_id, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING created_at, updated_at`,
      [id, params.meetingId, params.anchorSegmentId, params.authorUserId, params.body],
    );

    logger.debug({ meetingId: params.meetingId, noteId: id }, 'note added');
    return {
      id,
      meetingId:       params.meetingId,
      anchorSegmentId: params.anchorSegmentId,
      authorUserId:    params.authorUserId,
      body:            params.body,
      createdAt:       rows[0]!.created_at,
      updatedAt:       rows[0]!.updated_at,
    };
  }

  /** Updates a note body. Only the original author may update. */
  async updateNote(noteId: string, body: string, authorUserId: string): Promise<void> {
    const { rows } = await this.deps.pool.query<{ author_user_id: string }>(
      `SELECT author_user_id FROM transcript_notes WHERE id = $1`,
      [noteId],
    );
    if (!rows[0]) throw new NotFoundError(`Note ${noteId} not found`);
    if (rows[0].author_user_id !== authorUserId) {
      throw new ForbiddenError('Only the note author may update this note');
    }

    await this.deps.pool.query(
      `UPDATE transcript_notes SET body = $2, updated_at = now() WHERE id = $1`,
      [noteId, body],
    );
  }

  /** Deletes a note. Only the original author may delete. */
  async deleteNote(noteId: string, authorUserId: string): Promise<void> {
    const { rows } = await this.deps.pool.query<{ author_user_id: string }>(
      `SELECT author_user_id FROM transcript_notes WHERE id = $1`,
      [noteId],
    );
    if (!rows[0]) throw new NotFoundError(`Note ${noteId} not found`);
    if (rows[0].author_user_id !== authorUserId) {
      throw new ForbiddenError('Only the note author may delete this note');
    }

    await this.deps.pool.query(
      `DELETE FROM transcript_notes WHERE id = $1`,
      [noteId],
    );
  }
}
