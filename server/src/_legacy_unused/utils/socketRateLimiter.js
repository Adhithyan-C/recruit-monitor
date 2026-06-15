const DEFAULT_WINDOW_MS = 1000;
const MAX_BUCKETS = 10000;
const STALE_BUCKET_MS = 5 * 60 * 1000;

const RULES = {
  'interviewer:create-room': { socketLimit: 5, roomLimit: 5, windowMs: 60 * 1000 },
  'candidate:join': { socketLimit: 10, roomLimit: 20, windowMs: 60 * 1000 },
  'candidate:rejoin': { socketLimit: 20, roomLimit: 40, windowMs: 60 * 1000 },
  'supervisor:join-room': { socketLimit: 20, roomLimit: 40, windowMs: 60 * 1000 },
  'transcript:update': { socketLimit: 10, roomLimit: 20, windowMs: 1000 },
  'transcript:audio-chunk': { socketLimit: 100, roomLimit: 120, windowMs: 1000 },
};

export class SocketRateLimiter {
  constructor() {
    this._buckets = new Map();
    this._cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
    this._cleanupInterval.unref?.();
  }

  check({ socketId, roomId, event }) {
    const rule = RULES[event] || { socketLimit: 20, roomLimit: 40, windowMs: DEFAULT_WINDOW_MS };
    const now = Date.now();
    const socketAllowed = this._consume(`socket:${socketId}:${event}`, rule.socketLimit, rule.windowMs, now);
    const roomAllowed = roomId
      ? this._consume(`room:${roomId}:${event}`, rule.roomLimit, rule.windowMs, now)
      : true;

    return {
      allowed: socketAllowed && roomAllowed,
      scope: !socketAllowed ? 'socket' : !roomAllowed ? 'room' : null,
    };
  }

  cleanupSocket(socketId) {
    const prefix = `socket:${socketId}:`;
    for (const key of this._buckets.keys()) {
      if (key.startsWith(prefix)) this._buckets.delete(key);
    }
  }

  cleanupRoom(roomId) {
    const prefix = `room:${roomId}:`;
    for (const key of this._buckets.keys()) {
      if (key.startsWith(prefix)) this._buckets.delete(key);
    }
  }

  cleanup() {
    const cutoff = Date.now() - STALE_BUCKET_MS;
    for (const [key, bucket] of this._buckets) {
      if (bucket.updatedAt < cutoff) this._buckets.delete(key);
    }

    if (this._buckets.size <= MAX_BUCKETS) return;

    const entries = Array.from(this._buckets.entries())
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (const [key] of entries.slice(0, this._buckets.size - MAX_BUCKETS)) {
      this._buckets.delete(key);
    }
  }

  stop() {
    clearInterval(this._cleanupInterval);
    this._buckets.clear();
  }

  _consume(key, limit, windowMs, now) {
    let bucket = this._buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs, updatedAt: now };
      this._buckets.set(key, bucket);
    }

    bucket.count++;
    bucket.updatedAt = now;
    return bucket.count <= limit;
  }
}

export function enforceRateLimit({ socket, limiter, event, roomId, logger, namespace }) {
  const result = limiter.check({ socketId: socket.id, roomId, event });
  if (result.allowed) return true;

  socket.emit('socket:rate-limit', {
    event,
    reason: 'rate_limited',
    scope: result.scope,
  });
  logger?.warn('socket event rate limited', {
    namespace,
    socketId: socket.id,
    roomId,
    event,
    scope: result.scope,
  });
  return false;
}
