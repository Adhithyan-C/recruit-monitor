import type { Socket } from 'socket.io';
import type { SessionService } from '../../domain/SessionService.js';
import { logger } from '../../lib/logger.js';

/**
 * Optional middleware — runs after requireJwtSocket.
 * Reads reconnect_token from handshake.auth, looks it up in the sessions
 * table, and attaches the SessionRecord to socket.data.session if valid.
 *
 * Never rejects the connection — missing or expired tokens are silently
 * ignored so that fresh connects go through the normal path.
 */
export function attachReconnectSession(sessionService: SessionService) {
  return async (socket: Socket, next: (err?: Error) => void): Promise<void> => {
    const token = socket.handshake.auth['reconnect_token'] as string | undefined;

    if (!token) {
      next();
      return;
    }

    try {
      const session = await sessionService.findByToken(token);
      if (session) {
        // Carry the record into the connection handler via socket.data.
        // The handler consumes (deletes) it on a successful reconnect.
        (socket.data as { session?: typeof session }).session = session;
      }
    } catch (err) {
      // DB error — fail-soft so the connection is not blocked.
      logger.error({ err }, 'attachReconnectSession: lookup failed, proceeding without session');
    }

    next();
  };
}
