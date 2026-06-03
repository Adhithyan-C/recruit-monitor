import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JobScheduler } from '../../src/scheduler/JobScheduler.js';

describe('JobScheduler', () => {
  let scheduler: JobScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    scheduler = new JobScheduler();
  });

  afterEach(() => {
    scheduler.cancelAll();
    vi.useRealTimers();
  });

  it('fires handler after the scheduled delay', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    scheduler.schedule('job1', new Date(Date.now() + 1_000), handler);

    expect(handler).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('fires immediately when runAt is in the past', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    scheduler.schedule('job1', new Date(Date.now() - 5_000), handler);

    await vi.runAllTimersAsync();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('cancel prevents handler from firing', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    scheduler.schedule('job1', new Date(Date.now() + 1_000), handler);

    scheduler.cancel('job1');

    await vi.runAllTimersAsync();
    expect(handler).not.toHaveBeenCalled();
  });

  it('scheduling the same jobId replaces the first job', async () => {
    const handler1 = vi.fn().mockResolvedValue(undefined);
    const handler2 = vi.fn().mockResolvedValue(undefined);

    scheduler.schedule('job1', new Date(Date.now() + 1_000), handler1);
    scheduler.schedule('job1', new Date(Date.now() + 2_000), handler2);

    await vi.runAllTimersAsync();
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it('has() returns true while pending and false after firing', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    scheduler.schedule('job1', new Date(Date.now() + 1_000), handler);

    expect(scheduler.has('job1')).toBe(true);
    await vi.runAllTimersAsync();
    expect(scheduler.has('job1')).toBe(false);
  });

  it('has() returns false for an unknown jobId', () => {
    expect(scheduler.has('nonexistent')).toBe(false);
  });

  it('cancelAll() removes all pending jobs', async () => {
    const h1 = vi.fn().mockResolvedValue(undefined);
    const h2 = vi.fn().mockResolvedValue(undefined);

    scheduler.schedule('j1', new Date(Date.now() + 1_000), h1);
    scheduler.schedule('j2', new Date(Date.now() + 2_000), h2);
    expect(scheduler.size).toBe(2);

    scheduler.cancelAll();
    expect(scheduler.size).toBe(0);

    await vi.runAllTimersAsync();
    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });
});
