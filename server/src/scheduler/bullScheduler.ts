import { Queue, Worker } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export interface IScheduler {
  schedule(name: string, data: unknown, delayMs: number, jobId?: string): Promise<void>;
  cancel(jobId: string): Promise<void>;
  getJobCount(): Promise<number>;
}

/** Parse REDIS_URL into plain ioredis options so BullMQ creates its own connections.
 *  Avoids the structural type conflict between standalone ioredis and BullMQ's bundled copy.
 *  Safe to call only when env.REDIS_URL is defined (i.e. BullScheduler is only instantiated
 *  after waitForRedis() confirms Redis is available). */
function redisConnection() {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const u = new URL(env.REDIS_URL!);
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
    try {
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
    } catch (err) {
      logger.error({ err }, 'BullScheduler: worker failed to start — scheduled jobs will not fire');
    }
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

/**
 * In-memory fallback scheduler used when Redis is unavailable.
 * Implements the same public API as BullScheduler so it is a drop-in replacement.
 * Jobs are lost on server restart (acceptable for local dev / Redis-down scenarios).
 */
export class MemoryScheduler implements IScheduler {
  private readonly _jobs = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly handlers = new Map<string, (data: Record<string, unknown>) => Promise<void>>();

  registerHandler(name: string, handler: (data: Record<string, unknown>) => Promise<void>): void {
    this.handlers.set(name, handler);
  }

  start(): void { /* no-op: handlers fire inline via setTimeout */ }

  async schedule(name: string, data: unknown, delayMs: number, jobId?: string): Promise<void> {
    const id = jobId ?? `${name}:${Date.now()}`;
    if (jobId) this._cancel(jobId);
    const handler = this.handlers.get(name);
    if (!handler) {
      logger.warn({ name }, 'MemoryScheduler: no handler registered for job');
      return;
    }
    const timeout = setTimeout(() => {
      this._jobs.delete(id);
      handler(data as Record<string, unknown>).catch((err: unknown) => {
        logger.error({ id, name, err }, 'MemoryScheduler: job failed');
      });
    }, Math.max(0, delayMs));
    timeout.unref?.();
    this._jobs.set(id, timeout);
  }

  async cancel(jobId: string): Promise<void> {
    this._cancel(jobId);
  }

  async getJobCount(): Promise<number> {
    return this._jobs.size;
  }

  async close(): Promise<void> {
    for (const t of this._jobs.values()) clearTimeout(t);
    this._jobs.clear();
  }

  private _cancel(jobId: string): void {
    const t = this._jobs.get(jobId);
    if (t !== undefined) {
      clearTimeout(t);
      this._jobs.delete(jobId);
    }
  }
}
