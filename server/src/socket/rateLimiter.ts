import type { Socket } from 'socket.io';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  key?: (socket: Socket) => string;
}

interface Bucket {
  count: number;
  resetAt: number;
  lastSeenAt: number;
}

const buckets = new Map<string, Bucket>();
const CLEANUP_INTERVAL_MS = 60_000;
const STALE_BUCKET_MS = 5 * 60_000;

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.lastSeenAt > STALE_BUCKET_MS) {
        buckets.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
}

export function checkSocketRateLimit(
  socket: Socket,
  eventName: string,
  options: RateLimitOptions,
): boolean {
  ensureCleanupTimer();

  const now = Date.now();
  const userId = (socket.data as { user?: { userId?: string } }).user?.userId ?? socket.id;
  const key = options.key?.(socket) ?? `${socket.nsp.name}:${eventName}:${userId}`;
  const existing = buckets.get(key);

  if (!existing || now >= existing.resetAt) {
    buckets.set(key, {
      count: 1,
      resetAt: now + options.windowMs,
      lastSeenAt: now,
    });
    return true;
  }

  existing.count += 1;
  existing.lastSeenAt = now;
  return existing.count <= options.limit;
}
