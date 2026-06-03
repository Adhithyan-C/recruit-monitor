import type { Pool } from 'pg';
import type { JobScheduler } from '../scheduler/JobScheduler.js';
import { logger } from '../lib/logger.js';
import { newId } from '../lib/ids.js';
import { NotFoundError, InvalidTransitionError } from '../lib/errors.js';
import {
  guardMeetingTransition,
  guardCandidateTransition,
  type MeetingStatus,
  type CandidateStatus,
} from './meetingMachine.js';

export interface ClaimServiceDeps {
  pool: Pool;
  scheduler: JobScheduler;
  claimTtlSeconds: number;
  /** Called after a candidate is successfully restored to 'waiting' on claim expiry. */
  onCandidateRequeued: (candidateId: string) => Promise<void>;
}

interface MeetingRow {
  id: string;
  candidate_id: string;
  status: MeetingStatus;
}

interface CandidatePresenceRow {
  user_id: string;
  status: CandidateStatus;
}

export class ClaimService {
  constructor(private readonly deps: ClaimServiceDeps) {}

  /**
   * Schedules (or reschedules) the claim expiry timer for a meeting.
   * Called after a successful claim and by recovery at boot.
   */
  scheduleClaimExpiry(meetingId: string, claimedAt: Date): void {
    const runAt = new Date(claimedAt.getTime() + this.deps.claimTtlSeconds * 1000);
    this.deps.scheduler.schedule(
      `claim_expiry:${meetingId}`,
      runAt,
      () => this.onClaimExpired(meetingId),
    );
  }

  /**
   * Creates the meeting row and transitions candidate: waiting → claimed atomically.
   * Meeting is inserted directly at 'claimed' — no waiting state.
   * The one_active_meeting_per_candidate unique index is the hard DB backstop
   * against any concurrent claim that races past the FOR UPDATE on presence.
   * Returns the new meetingId.
   */
  async claimCandidate(candidateId: string, interviewerId: string): Promise<string> {
    const client = await this.deps.pool.connect();
    try {
      await client.query('BEGIN');

      // Lock presence first — serializes concurrent claims on the same candidate.
      const { rows: presenceRows } = await client.query<CandidatePresenceRow>(
        `SELECT user_id, status FROM candidate_presence WHERE user_id = $1 FOR UPDATE`,
        [candidateId],
      );
      const presence = presenceRows[0];
      if (!presence) throw new NotFoundError(`Candidate presence for ${candidateId} not found`);

      // Throws InvalidTransitionError if presence.status !== 'waiting'.
      guardCandidateTransition(presence.status, 'claimed');

      const meetingId   = newId();
      const agoraChannel = newId();
      const claimedAt   = new Date();

      // Insert at 'claimed' directly — unique index fires here for any loser
      // that somehow acquired the presence lock after the winner already committed.
      await client.query(
        `INSERT INTO meetings (id, candidate_id, interviewer_id, status, agora_channel, created_at)
         VALUES ($1, $2, $3, 'claimed', $4, $5)`,
        [meetingId, candidateId, interviewerId, agoraChannel, claimedAt],
      );

      await client.query(
        `UPDATE candidate_presence
            SET status             = 'claimed',
                claimed_by         = $2,
                claimed_at         = $3,
                current_meeting_id = $4,
                updated_at         = $3
          WHERE user_id = $1`,
        [candidateId, interviewerId, claimedAt, meetingId],
      );

      await client.query('COMMIT');

      // Timer registered after commit. If process crashes here, recovery at next
      // boot finds status='claimed' and reschedules via onClaimExpired callback.
      this.scheduleClaimExpiry(meetingId, claimedAt);
      logger.info({ meetingId, interviewerId, candidateId }, 'candidate claimed');
      return meetingId;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Called by the scheduler when CLAIM_TTL_SECONDS elapses without a candidate join.
   * Transitions meeting: claimed → waiting.
   * Transitions candidate: claimed → waiting — or skips (debug log) if already offline.
   * If the meeting has already progressed past 'claimed', exits cleanly.
   */
  async onClaimExpired(meetingId: string): Promise<void> {
    const client = await this.deps.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: meetingRows } = await client.query<MeetingRow>(
        `SELECT id, candidate_id, status FROM meetings WHERE id = $1 FOR UPDATE`,
        [meetingId],
      );
      const meeting = meetingRows[0];
      if (!meeting) {
        await client.query('ROLLBACK');
        logger.debug({ meetingId }, 'claim_expired: meeting not found, skipping');
        return;
      }

      try {
        guardMeetingTransition(meeting.status, 'claim_expired');
      } catch (err) {
        await client.query('ROLLBACK');
        if (err instanceof InvalidTransitionError) {
          logger.debug(
            { meetingId, currentStatus: meeting.status },
            'claim_expired: meeting already transitioned, skipping',
          );
          return;
        }
        throw err;
      }

      await client.query(
        `UPDATE meetings SET status = 'waiting' WHERE id = $1`,
        [meetingId],
      );

      const { rows: presenceRows } = await client.query<CandidatePresenceRow>(
        `SELECT user_id, status FROM candidate_presence WHERE user_id = $1 FOR UPDATE`,
        [meeting.candidate_id],
      );
      const presence = presenceRows[0];

      let didRequeue = false;
      if (presence) {
        try {
          guardCandidateTransition(presence.status, 'claim_expired');
          await client.query(
            `UPDATE candidate_presence
                SET status     = 'waiting',
                    claimed_by = NULL,
                    claimed_at = NULL,
                    updated_at = now()
              WHERE user_id = $1`,
            [meeting.candidate_id],
          );
          didRequeue = true;
        } catch (err) {
          if (err instanceof InvalidTransitionError) {
            // Candidate went offline during the claim window — already handled by socket
            // disconnect path. No requeue needed; sweeper will clean up presence if stale.
            logger.debug(
              { meetingId, candidateId: meeting.candidate_id, candidateStatus: presence.status },
              'claim_expired: candidate not in claimed state, skipping requeue',
            );
          } else {
            throw err;
          }
        }
      }

      await client.query('COMMIT');
      logger.info({ meetingId, candidateId: meeting.candidate_id }, 'claim expired — meeting requeued');

      if (didRequeue) {
        this.deps.onCandidateRequeued(meeting.candidate_id).catch((err) =>
          logger.error({ err, candidateId: meeting.candidate_id }, 'onCandidateRequeued failed'),
        );
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
