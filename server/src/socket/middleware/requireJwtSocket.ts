import type { Socket } from 'socket.io';
import { verifyInternalJwt } from '../../auth/jwt.js';

/**
 * Socket.IO middleware for /interviewer and /supervisor namespaces.
 * Reads the internal JWT from handshake.auth.token and attaches the
 * decoded payload to socket.data.user. Passes a plain Error (not DomainError)
 * to next() so Socket.IO serialises it cleanly to the client.
 */
export function requireJwtSocket(
  socket: Socket & { data: { user?: ReturnType<typeof verifyInternalJwt> } },
  next: (err?: Error) => void,
  requiredRole?: string,
): void {
  const token = socket.handshake.auth['token'] as string | undefined;
  if (!token) {
    next(new Error('AUTH_ERROR: missing token'));
    return;
  }
  try {
    socket.data.user = verifyInternalJwt(token);
    if (requiredRole && socket.data.user.role !== requiredRole) {
      next(new Error('AUTH_ERROR: forbidden namespace'));
      return;
    }
    next();
  } catch (err) {
    const expired = err instanceof Error && err.name === 'TokenExpiredError';
    next(new Error(expired ? 'AUTH_ERROR: token expired' : 'AUTH_ERROR: invalid token'));
  }
}
