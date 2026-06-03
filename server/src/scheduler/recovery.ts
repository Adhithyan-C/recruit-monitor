import type { Pool } from 'pg';
import type { JobScheduler } from './JobScheduler.js';
import { logger } from '../lib/logger.js';

export interface RecoveryDeps {
  pool: Pool;
  scheduler: JobScheduler;
  claimTtlSeconds: number;
  graceWindowSeconds: number;
  /** Called when a claimed meeting's claim TTL has elapsed. Injected from ClaimService (Phase 5). */
  onClaimExpired: (meetingId: string) => Promise<void>;
  /** Called when an interrupted meeting's grace window has elapsed. Injected from MeetingService (Phase 5). */
  onGraceExpired: (meetingId: string) => Promise<void>;
}

/**
 * Runs once at boot — BEFORE the HTTP server starts accepting connections.
 *
 * Reconstructs in-flight setTimeout jobs from DB timestamps so that
 * server restarts do not silently drop pending claim expirations or grace timers.
 * This is safe to call with an empty DB (returns immediately with no work done).
 */
export async function recoverScheduledJobs(deps: RecoveryDeps): Promise<void> {
  const {
    pool,
    scheduler,
    claimTtlSeconds,
    graceWindowSeconds,
    onClaimExpired,
    onGraceExpired,
  } = deps;

  let recovered = 0;

  // ── 1. Claimed meetings — reschedule claim expiry ──────────────────
  // claimed_at lives on candidate_presence; join via candidate_id.
  const { rows: claimed } = await pool.query<{
    id: string;
    claimed_at: Date;
  }>(
    `SELECT m.id, cp.claimed_at
       FROM meetings m
       JOIN candidate_presence cp ON cp.user_id = m.candidate_id
      WHERE m.status = 'claimed'
        AND cp.claimed_at IS NOT NULL`
  );

  for (const row of claimed) {
    const runAt = new Date(row.claimed_at.getTime() + claimTtlSeconds * 1000);
    const jobId = `claim_expiry:${row.id}`;
    const past = runAt <= new Date();
    scheduler.schedule(jobId, runAt, () => onClaimExpired(row.id));
    logger.info({ meetingId: row.id, runAt, past }, 'recovery: claim expiry scheduled');
    recovered++;
  }

  // ── 2. Interrupted meetings — reschedule grace expiry ─────────────
  // Use the latest disconnected_at across all participants.
  // Falls back to now() if no participant has a recorded disconnect
  // (e.g. server crashed before it could record the timestamp).
  const { rows: interrupted } = await pool.query<{
    id: string;
    latest_disconnect: Date | null;
  }>(
    `SELECT m.id, MAX(mp.disconnected_at) AS latest_disconnect
       FROM meetings m
       LEFT JOIN meeting_participants mp ON mp.meeting_id = m.id
      WHERE m.status = 'interrupted'
      GROUP BY m.id`
  );

  for (const row of interrupted) {
    const base = row.latest_disconnect ?? new Date();
    const runAt = new Date(base.getTime() + graceWindowSeconds * 1000);
    const jobId = `grace_expiry:${row.id}`;
    const past = runAt <= new Date();
    scheduler.schedule(jobId, runAt, () => onGraceExpired(row.id));
    logger.info({ meetingId: row.id, runAt, past }, 'recovery: grace expiry scheduled');
    recovered++;
  }

  // ── 3. Expired sessions — delete in batch ─────────────────────────
  const deleteResult = await pool.query(
    `DELETE FROM sessions WHERE expires_at < now()`
  );
  const deletedSessions = deleteResult.rowCount ?? 0;

  logger.info({ recovered, deletedSessions }, 'recovery complete');
}
