import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Pool } from 'pg';
import { startPresenceSweeper } from '../../src/scheduler/sweeper.js';

function makePool(
  updateRows: Array<{ user_id: string }>,
  deleteRowCount = 0
) {
  return {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: updateRows, rowCount: updateRows.length })  // UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: deleteRowCount }),             // DELETE
  } as unknown as Pool;
}

describe('startPresenceSweeper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks stale candidates offline and calls onPresenceEvicted', async () => {
    const staleUserId = 'user-stale-1';
    const pool = makePool([{ user_id: staleUserId }]);
    const onPresenceEvicted = vi.fn().mockResolvedValue(undefined);

    const sweeper = startPresenceSweeper({
      pool,
      intervalMs: 15_000,
      staleAfterSeconds: 30,
      onPresenceEvicted,
    });

    await vi.advanceTimersByTimeAsync(15_000);

    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(onPresenceEvicted).toHaveBeenCalledOnce();
    expect(onPresenceEvicted).toHaveBeenCalledWith([staleUserId]);

    sweeper.stop();
  });

  it('does not call onPresenceEvicted when no stale rows returned', async () => {
    const pool = makePool([]);
    const onPresenceEvicted = vi.fn().mockResolvedValue(undefined);

    const sweeper = startPresenceSweeper({
      pool,
      intervalMs: 15_000,
      staleAfterSeconds: 30,
      onPresenceEvicted,
    });

    await vi.advanceTimersByTimeAsync(15_000);

    expect(onPresenceEvicted).not.toHaveBeenCalled();

    sweeper.stop();
  });

  it('calls onPresenceEvicted with all evicted user IDs in one batch', async () => {
    const pool = makePool([
      { user_id: 'user-a' },
      { user_id: 'user-b' },
      { user_id: 'user-c' },
    ]);
    const onPresenceEvicted = vi.fn().mockResolvedValue(undefined);

    const sweeper = startPresenceSweeper({
      pool,
      intervalMs: 15_000,
      staleAfterSeconds: 30,
      onPresenceEvicted,
    });

    await vi.advanceTimersByTimeAsync(15_000);

    expect(onPresenceEvicted).toHaveBeenCalledWith(['user-a', 'user-b', 'user-c']);

    sweeper.stop();
  });

  it('runs on every interval tick', async () => {
    // Provide enough responses for 3 ticks
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    } as unknown as Pool;
    const onPresenceEvicted = vi.fn().mockResolvedValue(undefined);

    const sweeper = startPresenceSweeper({
      pool,
      intervalMs: 15_000,
      staleAfterSeconds: 30,
      onPresenceEvicted,
    });

    await vi.advanceTimersByTimeAsync(45_000); // 3 ticks
    // Each tick issues 2 queries (UPDATE + DELETE)
    expect(pool.query).toHaveBeenCalledTimes(6);

    sweeper.stop();
  });

  it('stop() prevents further ticks', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    } as unknown as Pool;
    const onPresenceEvicted = vi.fn();

    const sweeper = startPresenceSweeper({
      pool,
      intervalMs: 15_000,
      staleAfterSeconds: 30,
      onPresenceEvicted,
    });

    await vi.advanceTimersByTimeAsync(15_000); // 1 tick
    sweeper.stop();

    const countAfterStop = (pool.query as ReturnType<typeof vi.fn>).mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000); // 2 more intervals pass
    expect(pool.query).toHaveBeenCalledTimes(countAfterStop); // no new calls
  });
});
