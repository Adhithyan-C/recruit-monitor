import type { Pool } from 'pg';
import { logger } from '../lib/logger.js';
import { ConflictError, InvalidTransitionError } from '../lib/errors.js';
import {
  guardCandidateTransition,
  type CandidateStatus,
} from './meetingMachine.js';

export interface QueuedCandidate {
  userId:              string;
  name:                string;
  email:               string;
  queuedAt:            string; // ISO timestamp — cp.updated_at, set on every setWaiting UPSERT
  priorInterviewCount: number; // count of ended meetings for this candidate
}

export interface PresenceServiceDeps {
  pool: Pool;
  /** Pushes queue state to interviewer dashboards. Injected in Phase 6; no-op until then. */
  onBroadcast: (candidates: QueuedCandidate[]) => Promise<void>;
}

interface CandidatePresenceRow {
  user_id: string;
  status: CandidateStatus;
}

export class PresenceService {
  constructor(private readonly deps: PresenceServiceDeps) {}

  /**
   * Candidate socket connects with no active meeting.
   * Transitions: offline → waiting.
   */
  async setWaiting(userId: string, socketId: string): Promise<void> {
    const client = await this.deps.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: activeMeetings } = await client.query<{ id: string; status: string }>(
        `SELECT id, status
           FROM meetings
          WHERE candidate_id = $1
            AND status IN ('claimed', 'connecting', 'active', 'interrupted')
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE`,
        [userId],
      );

      if (activeMeetings[0]) {
        await client.query('ROLLBACK');
        logger.warn(
          { userId, socketId, meetingId: activeMeetings[0].id, status: activeMeetings[0].status },
          'setWaiting blocked: candidate has nonterminal meeting',
        );
        throw new ConflictError('Candidate has an active meeting lifecycle');
      }

      await client.query(
        `INSERT INTO candidate_presence (user_id, status, socket_id, last_heartbeat_at, updated_at)
         VALUES ($1, 'waiting', $2, now(), now())
         ON CONFLICT (user_id) DO UPDATE
           SET status             = 'waiting',
               socket_id          = EXCLUDED.socket_id,
               last_heartbeat_at  = now(),
               claimed_by         = NULL,
               claimed_at         = NULL,
               current_meeting_id = NULL,
               updated_at         = now()`,
        [userId, socketId],
      );

      await client.query('COMMIT');
      logger.info({ userId, socketId }, 'candidate waiting');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /** Updates last_heartbeat_at only. No status change, no guard, no transaction needed. */
  async heartbeat(userId: string): Promise<void> {
    await this.deps.pool.query(
      `UPDATE candidate_presence SET last_heartbeat_at = now() WHERE user_id = $1`,
      [userId],
    );
  }

  /**
   * Candidate socket disconnects outside a meeting.
   * Transitions: waiting|claimed → offline.
   * Clears socket_id. Does not touch claimed_by/claimed_at — ClaimService owns that on expiry.
   * Silently skips (debug log) if the candidate is in a meeting state — MeetingService handles those.
   */
  async setOffline(userId: string): Promise<void> {
    const client = await this.deps.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query<CandidatePresenceRow>(
        `SELECT user_id, status FROM candidate_presence WHERE user_id = $1 FOR UPDATE`,
        [userId],
      );
      const presence = rows[0];
      if (!presence) {
        await client.query('ROLLBACK');
        logger.debug({ userId }, 'setOffline: presence not found, skipping');
        return;
      }

      try {
        guardCandidateTransition(presence.status, 'socket_disconnect');
      } catch (err) {
        await client.query('ROLLBACK');
        if (err instanceof InvalidTransitionError) {
          // Candidate is in_meeting or disconnected — MeetingService owns that path.
          logger.debug(
            { userId, currentStatus: presence.status },
            'setOffline: candidate in meeting state, skipping',
          );
          return;
        }
        throw err;
      }

      await client.query(
        `UPDATE candidate_presence
            SET status    = 'offline',
                socket_id = NULL,
                updated_at = now()
          WHERE user_id = $1`,
        [userId],
      );

      await client.query('COMMIT');
      logger.info({ userId }, 'candidate offline');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /** Returns all waiting candidates with name, email, queue-entry time, and prior interview count. Ordered FIFO by updated_at. */
  async getWaitingCandidates(): Promise<QueuedCandidate[]> {
    const { rows } = await this.deps.pool.query<{
      user_id:               string;
      name:                  string;
      email:                 string;
      queued_at:             Date;
      prior_interview_count: number;
    }>(
      `SELECT cp.user_id,
              u.name,
              u.email,
              cp.updated_at                                                         AS queued_at,
              COALESCE(ic.cnt, 0)                                                   AS prior_interview_count
         FROM candidate_presence cp
         JOIN users u ON u.id = cp.user_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::integer AS cnt
             FROM meetings
            WHERE candidate_id = cp.user_id
              AND status = 'ended'
         ) ic ON true
        WHERE cp.status = 'waiting'
        ORDER BY cp.updated_at`,
    );
    return rows.map((r) => ({
      userId:              r.user_id,
      name:                r.name,
      email:               r.email,
      queuedAt:            r.queued_at.toISOString(),
      priorInterviewCount: r.prior_interview_count,
    }));
  }

  /**
   * Pushes queue state updates to interviewer dashboards.
   * Called by the sweeper after eviction and by ClaimService/MeetingService after transitions.
   * The _userIds parameter is ignored — a fresh full snapshot is always broadcast.
   */
  async broadcastPresenceDelta(_userIds: string[]): Promise<void> {
    const candidates = await this.getWaitingCandidates();
    await this.deps.onBroadcast(candidates);
  }
}
