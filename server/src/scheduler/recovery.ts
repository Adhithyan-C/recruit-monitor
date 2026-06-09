import type { Pool } from 'pg';
import { logger } from '../lib/logger.js';

export interface RecoveryDeps {
  pool: Pool;
}

/**
 * Runs once at boot — BEFORE the HTTP server starts accepting connections.
 *
 * BullMQ persists delayed jobs in Redis, so timer recovery is no longer needed
 * here. The only boot-time cleanup is expired sessions.
 */
export async function recoverScheduledJobs(deps: RecoveryDeps): Promise<void> {
  const deleteResult = await deps.pool.query(`DELETE FROM sessions WHERE expires_at < now()`);
  const deletedSessions = deleteResult.rowCount ?? 0;
  logger.info({ deletedSessions }, 'recovery complete');
}
