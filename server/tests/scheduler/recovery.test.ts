import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Pool } from 'pg';
import { recoverScheduledJobs } from '../../src/scheduler/recovery.js';
import { JobScheduler } from '../../src/scheduler/JobScheduler.js';

/** Minimal mock that satisfies Pool for the queries recovery.ts issues. */
function makePool(responses: Array<{ rows: Record<string, unknown>[]; rowCount?: number }>) {
  let call = 0;
  return {
    query: vi.fn(async () => {
      const r = responses[call++];
      return { rows: r?.rows ?? [], rowCount: r?.rowCount ?? 0 };
    }),
  } as unknown as Pool;
}

describe('recoverScheduledJobs', () => {
  let scheduler: JobScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    scheduler = new JobScheduler();
  });

  afterEach(() => {
    scheduler.cancelAll();
    vi.useRealTimers();
  });

  it('fires claim expiry handler immediately when claimed_at is in the past', async () => {
    const meetingId = 'meeting-claimed-1';
    const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1_000);

    const pool = makePool([
      { rows: [{ id: meetingId, claimed_at: twoMinsAgo }] }, // claimed meetings
      { rows: [] },                                            // interrupted meetings
      { rows: [], rowCount: 0 },                              // delete sessions
    ]);

    const onClaimExpired = vi.fn().mockResolvedValue(undefined);
    const onGraceExpired = vi.fn().mockResolvedValue(undefined);

    await recoverScheduledJobs({
      pool,
      scheduler,
      claimTtlSeconds: 60,       // expiry = twoMinsAgo + 60s = ~60s in the past
      graceWindowSeconds: 30,
      onClaimExpired,
      onGraceExpired,
    });

    // runAt is in the past → delay=0 → fires on next tick
    await vi.runAllTimersAsync();
    expect(onClaimExpired).toHaveBeenCalledWith(meetingId);
    expect(onGraceExpired).not.toHaveBeenCalled();
  });

  it('schedules grace expiry in the future for an interrupted meeting', async () => {
    const meetingId = 'meeting-interrupted-1';
    const tenSecsAgo = new Date(Date.now() - 10_000);

    const pool = makePool([
      { rows: [] },                                                                   // claimed
      { rows: [{ id: meetingId, latest_disconnect: tenSecsAgo }] },  // interrupted
      { rows: [], rowCount: 0 },
    ]);

    const onGraceExpired = vi.fn().mockResolvedValue(undefined);

    await recoverScheduledJobs({
      pool,
      scheduler,
      claimTtlSeconds: 60,
      graceWindowSeconds: 30,  // runAt = tenSecsAgo + 30s = 20s from now
      onClaimExpired: vi.fn(),
      onGraceExpired,
    });

    // Job should be pending — not yet fired
    expect(scheduler.has(`grace_expiry:${meetingId}`)).toBe(true);
    expect(onGraceExpired).not.toHaveBeenCalled();

    // Advance 25s → past the 20s remaining grace window
    await vi.advanceTimersByTimeAsync(25_000);
    expect(onGraceExpired).toHaveBeenCalledWith(meetingId);
  });

  it('fires grace expiry immediately when the window has already passed', async () => {
    const meetingId = 'meeting-interrupted-2';
    const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1_000);

    const pool = makePool([
      { rows: [] },
      { rows: [{ id: meetingId, latest_disconnect: twoMinsAgo }] }, // disconnected 2m ago, grace is 30s
      { rows: [], rowCount: 0 },
    ]);

    const onGraceExpired = vi.fn().mockResolvedValue(undefined);

    await recoverScheduledJobs({
      pool,
      scheduler,
      claimTtlSeconds: 60,
      graceWindowSeconds: 30,
      onClaimExpired: vi.fn(),
      onGraceExpired,
    });

    await vi.runAllTimersAsync();
    expect(onGraceExpired).toHaveBeenCalledWith(meetingId);
  });

  it('deletes expired sessions and logs the count', async () => {
    const pool = makePool([
      { rows: [] },                // claimed
      { rows: [] },                // interrupted
      { rows: [], rowCount: 3 },   // 3 sessions deleted
    ]);

    await recoverScheduledJobs({
      pool,
      scheduler,
      claimTtlSeconds: 60,
      graceWindowSeconds: 30,
      onClaimExpired: vi.fn(),
      onGraceExpired: vi.fn(),
    });

    // Just verifying the DELETE query was issued (third call)
    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  it('is a no-op on a fresh database with no in-flight meetings', async () => {
    const pool = makePool([
      { rows: [] },
      { rows: [] },
      { rows: [], rowCount: 0 },
    ]);

    await recoverScheduledJobs({
      pool,
      scheduler,
      claimTtlSeconds: 60,
      graceWindowSeconds: 30,
      onClaimExpired: vi.fn(),
      onGraceExpired: vi.fn(),
    });

    expect(scheduler.size).toBe(0);
  });
});
