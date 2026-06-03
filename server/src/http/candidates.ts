import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Pool } from 'pg';
import { requireAuth } from './middleware/requireAuth.js';
import type { TranscriptService } from '../domain/TranscriptService.js';
import { canViewCandidateHistory } from '../policy/canViewCandidateHistory.js';

export function createCandidatesRouter(pool: Pool, transcriptService: TranscriptService): Router {
  const router = Router();

  // ── GET /candidates/:candidateId/history ──────────────────────────────
  // Index of all ended meetings for this candidate.
  // No transcripts/notes — just enough to render the history list.
  router.get('/:candidateId/history', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { candidateId } = req.params as { candidateId: string };

      if (!canViewCandidateHistory(req.user!, candidateId)) {
        res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
        return;
      }

      const { rows: userRows } = await pool.query<{ id: string }>(
        `SELECT id FROM users WHERE id = $1 AND role = 'candidate'`,
        [candidateId],
      );
      if (!userRows[0]) {
        res.status(404).json({ error: 'Candidate not found', code: 'NOT_FOUND' });
        return;
      }

      const { rows } = await pool.query<{
        meeting_id:       string;
        interviewer_name: string | null;
        started_at:       Date | null;
        ended_at:         Date | null;
        duration_minutes: number;
        segment_count:    number;
        note_count:       number;
      }>(
        `SELECT
           m.id                                                                         AS meeting_id,
           u.name                                                                       AS interviewer_name,
           m.started_at,
           m.ended_at,
           COALESCE(
             ROUND(EXTRACT(EPOCH FROM (m.ended_at - m.started_at)) / 60)::integer,
             0
           )                                                                            AS duration_minutes,
           (SELECT COUNT(*)::integer FROM transcript_segments ts WHERE ts.meeting_id = m.id) AS segment_count,
           (SELECT COUNT(*)::integer FROM transcript_notes    tn WHERE tn.meeting_id = m.id) AS note_count
         FROM meetings m
         LEFT JOIN users u ON u.id = m.interviewer_id
        WHERE m.candidate_id = $1
          AND m.status = 'ended'
        ORDER BY m.started_at DESC NULLS LAST`,
        [candidateId],
      );

      res.json({
        history: rows.map((r) => ({
          meetingId:       r.meeting_id,
          interviewerName: r.interviewer_name ?? null,
          startedAt:       r.started_at,
          endedAt:         r.ended_at,
          durationMinutes: r.duration_minutes,
          segmentCount:    r.segment_count,
          noteCount:       r.note_count,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // ── GET /candidates/:candidateId/history/:meetingId/transcript ────────
  // All transcript segments for one ended meeting, ordered by seq ASC.
  router.get('/:candidateId/history/:meetingId/transcript', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { candidateId, meetingId } = req.params as { candidateId: string; meetingId: string };

      if (!canViewCandidateHistory(req.user!, candidateId)) {
        res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
        return;
      }

      const meeting = await resolveMeeting(pool, meetingId, candidateId);
      if (!meeting) {
        res.status(404).json({ error: 'Meeting not found', code: 'NOT_FOUND' });
        return;
      }

      const segments = await transcriptService.getSegments(meetingId, 0, 5_000);
      res.json({ segments });
    } catch (err) {
      next(err);
    }
  });

  // ── GET /candidates/:candidateId/history/:meetingId/notes ─────────────
  // All notes for one ended meeting, ordered by created_at ASC.
  router.get('/:candidateId/history/:meetingId/notes', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { candidateId, meetingId } = req.params as { candidateId: string; meetingId: string };

      if (!canViewCandidateHistory(req.user!, candidateId)) {
        res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
        return;
      }

      const meeting = await resolveMeeting(pool, meetingId, candidateId);
      if (!meeting) {
        res.status(404).json({ error: 'Meeting not found', code: 'NOT_FOUND' });
        return;
      }

      const notes = await transcriptService.getNotes(meetingId);
      res.json({ notes });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

// Verifies the meeting exists, belongs to candidateId, and has status='ended'.
// Returns the row on success or null on any mismatch (unified 404 — no leakage).
async function resolveMeeting(
  pool: Pool,
  meetingId: string,
  candidateId: string,
): Promise<{ id: string } | null> {
  const { rows } = await pool.query<{ id: string; candidate_id: string; status: string }>(
    `SELECT id, candidate_id, status FROM meetings WHERE id = $1`,
    [meetingId],
  );
  const row = rows[0];
  if (!row || row.candidate_id !== candidateId || row.status !== 'ended') return null;
  return row;
}
