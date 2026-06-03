import type { Pool } from 'pg';
import { logger } from '../lib/logger.js';

export interface SweeperDeps {
  pool: Pool;
  intervalMs: number;
  staleAfterSeconds: number;
  /**
   * Called with the user IDs of candidates whose presence was just marked offline.
   * Implement this to broadcast presence deltas to interviewer dashboards.
   * Injected at startup — sweeper does not import socket modules directly.
   */
  onPresenceEvicted: (userIds: string[]) => Promise<void>;
}

export interface Sweeper {
  stop: () => void;
}

/**
 * Runs on a fixed interval. Marks waiting candidates offline when their
 * heartbeat has gone stale, and purges expired reconnect sessions.
 * Disconnected in-meeting candidates are left to MeetingService grace expiry.
 *
 * Returns a stop() function for graceful shutdown.
 */
export function startPresenceSweeper(deps: SweeperDeps): Sweeper {
  const { pool, intervalMs, staleAfterSeconds, onPresenceEvicted } = deps;

  async function tick(): Promise<void> {
    try {
      // Mark stale candidates offline and get their IDs.
      // Threshold is computed in Node so fake-timers in tests can control it.
      const threshold = new Date(Date.now() - staleAfterSeconds * 1000);

      const { rows } = await pool.query<{ user_id: string }>(
        `UPDATE candidate_presence
            SET status = 'offline', updated_at = now()
          WHERE status = 'waiting'
            AND last_heartbeat_at < $1
          RETURNING user_id`,
        [threshold]
      );

      if (rows.length > 0) {
        const userIds = rows.map((r) => r.user_id);
        logger.info({ count: rows.length }, 'sweeper: evicted stale presence');
        await onPresenceEvicted(userIds);
      }

      // Delete expired reconnect sessions in the same tick.
      const deleteResult = await pool.query(
        `DELETE FROM sessions WHERE expires_at < now()`
      );
      const deleted = deleteResult.rowCount ?? 0;
      if (deleted > 0) {
        logger.debug({ count: deleted }, 'sweeper: deleted expired sessions');
      }
    } catch (err) {
      logger.error({ err }, 'sweeper tick failed');
    }
  }

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();

  logger.info({ intervalMs, staleAfterSeconds }, 'presence sweeper started');

  return {
    stop: () => {
      clearInterval(timer);
      logger.info('presence sweeper stopped');
    },
  };
}
