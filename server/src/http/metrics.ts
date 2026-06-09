import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import type { IScheduler } from '../scheduler/bullScheduler.js';
import type { DeepgramManager } from '../lib/DeepgramManager.js';
import { requireAuth } from './middleware/requireAuth.js';

export function createMetricsRouter(
  pool: Pool,
  scheduler: IScheduler,
  deepgramManager: DeepgramManager,
): Router {
  const router = Router();

  router.get('/', requireAuth, async (req: Request, res: Response) => {
    if (!req.user || (req.user.role !== 'supervisor' && req.user.role !== 'admin')) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    const [meetingsResult, queueResult, scheduledJobs] = await Promise.all([
      pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM meetings WHERE status = 'active'`),
      pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM candidate_presence WHERE status = 'waiting'`),
      scheduler.getJobCount(),
    ]);

    res.json({
      activeMeetings:   parseInt(meetingsResult.rows[0]?.count ?? '0', 10),
      queueDepth:       parseInt(queueResult.rows[0]?.count ?? '0', 10),
      scheduledJobs,
      deepgramSessions: deepgramManager.sessionCount,
    });
  });

  return router;
}
