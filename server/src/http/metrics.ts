import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import type { JobScheduler } from '../scheduler/JobScheduler.js';
import type { DeepgramManager } from '../lib/DeepgramManager.js';

// TODO: Add authentication to this endpoint before exposing to the internet — aggregate counts are low-sensitivity but should not be public in production.
export function createMetricsRouter(
  pool: Pool,
  scheduler: JobScheduler,
  deepgramManager: DeepgramManager,
): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    const [meetingsResult, queueResult] = await Promise.all([
      pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM meetings WHERE status = 'active'`),
      pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM candidate_presence WHERE status = 'waiting'`),
    ]);

    res.json({
      activeMeetings:   parseInt(meetingsResult.rows[0]?.count ?? '0', 10),
      queueDepth:       parseInt(queueResult.rows[0]?.count ?? '0', 10),
      scheduledJobs:    scheduler.size,
      deepgramSessions: deepgramManager.sessionCount,
    });
  });

  return router;
}
