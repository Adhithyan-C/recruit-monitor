import { Queue, Worker } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export interface IScheduler {
  schedule(name: string, data: unknown, delayMs: number, jobId?: string): Promise<void>;
  cancel(jobId: string): Promise<void>;
  getJobCount(): Promise<number>;
}

/** Parse REDIS_URL into plain ioredis options so BullMQ creates its own connections.
 *  Avoids the structural type conflict between standalone ioredis and BullMQ's bundled copy. */
function redisConnection() {
  const u = new URL(env.REDIS_URL);
  return {
    host: u.hostname,
    port: Number(u.port) || 6379,
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    maxRetriesPerRequest: null as null, // required by BullMQ
    retryStrategy: (times: number) => Math.min(times * 200, 5_000),
  };
}

export class BullScheduler implements IScheduler {
  private readonly queue: Queue;
  private worker: Worker | null = null;
  private readonly handlers = new Map<string, (data: Record<string, unknown>) => Promise<void>>();

  constructor() {
    this.queue = new Queue('meeting-jobs', { connection: redisConnection() });
  }

  registerHandler(name: string, handler: (data: Record<string, unknown>) => Promise<void>): void {
    this.handlers.set(name, handler);
  }

  /** Start the worker. Call after all handlers are registered and services are wired up. */
  start(): void {
    this.worker = new Worker(
      'meeting-jobs',
      async (job) => {
        const handler = this.handlers.get(job.name);
        if (handler) {
          await handler(job.data as Record<string, unknown>);
        } else {
          logger.warn({ jobName: job.name }, 'BullScheduler: no handler registered for job');
        }
      },
      { connection: redisConnection() },
    );

    this.worker.on('failed', (job, err) => {
      logger.error({ jobName: job?.name, jobId: job?.id, err }, 'BullScheduler: job failed');
    });
  }

  async schedule(name: string, data: unknown, delayMs: number, jobId?: string): Promise<void> {
    await this.queue.add(name, data, {
      delay: Math.max(0, delayMs),
      jobId: jobId ?? undefined,
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }

  async cancel(jobId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (job) await job.remove();
  }

  async getJobCount(): Promise<number> {
    return this.queue.count();
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}
