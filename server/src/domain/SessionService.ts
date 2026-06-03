import { randomBytes } from 'crypto';
import type { Pool } from 'pg';
import { logger } from '../lib/logger.js';

export interface SessionServiceDeps {
  pool: Pool;
  sessionTtlSeconds: number;
}

export interface SessionRecord {
  id: string;
  userId: string;
  reconnectToken: string;
  expiresAt: Date;
}

export class SessionService {
  constructor(private readonly deps: SessionServiceDeps) {}

  /**
   * Issues a new reconnect token for a user.
   * Called immediately on socket connect — before any namespace-specific logic.
   * The token is opaque, 256-bit, URL-safe base64.
   */
  async create(userId: string): Promise<{ reconnectToken: string; expiresAt: Date }> {
    const reconnectToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.deps.sessionTtlSeconds * 1_000);

    await this.deps.pool.query(
      `INSERT INTO sessions (user_id, reconnect_token, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, reconnectToken, expiresAt],
    );

    logger.debug({ userId }, 'session created');
    return { reconnectToken, expiresAt };
  }

  /**
   * Atomically validates and consumes a reconnect token.
   * DELETE...RETURNING ensures only one simultaneous connection wins the token,
   * preventing replay attacks from concurrent handshakes.
   */
  async findByToken(reconnectToken: string): Promise<SessionRecord | null> {
    const { rows } = await this.deps.pool.query<{
      id: string;
      user_id: string;
      reconnect_token: string;
      expires_at: Date;
    }>(
      `DELETE FROM sessions
        WHERE reconnect_token = $1 AND expires_at > now()
        RETURNING id, user_id, reconnect_token, expires_at`,
      [reconnectToken],
    );

    if (!rows[0]) return null;

    return {
      id:             rows[0].id,
      userId:         rows[0].user_id,
      reconnectToken: rows[0].reconnect_token,
      expiresAt:      rows[0].expires_at,
    };
  }
}
