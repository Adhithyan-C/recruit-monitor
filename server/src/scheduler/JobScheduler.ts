import { logger } from '../lib/logger.js';

export class JobScheduler {
  private readonly _jobs = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Schedule a job to run at `runAt`. If a job with `jobId` already exists
   * it is replaced — the old handler will not fire.
   * If `runAt` is in the past the handler fires on the next event-loop tick.
   */
  schedule(jobId: string, runAt: Date, handler: () => Promise<void>): void {
    this.cancel(jobId);

    const delay = Math.max(0, runAt.getTime() - Date.now());

    const timeout = setTimeout(() => {
      this._jobs.delete(jobId);
      handler().catch((err: unknown) => {
        logger.error({ jobId, err }, 'scheduled job handler failed');
      });
    }, delay);

    // Do not keep the Node process alive just for scheduled domain jobs.
    timeout.unref?.();

    this._jobs.set(jobId, timeout);
  }

  cancel(jobId: string): void {
    const t = this._jobs.get(jobId);
    if (t !== undefined) {
      clearTimeout(t);
      this._jobs.delete(jobId);
    }
  }

  has(jobId: string): boolean {
    return this._jobs.has(jobId);
  }

  cancelAll(): void {
    for (const id of Array.from(this._jobs.keys())) {
      this.cancel(id);
    }
  }

  get size(): number {
    return this._jobs.size;
  }
}
