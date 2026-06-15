import { verifyToken } from '../utils/generateToken.js';
import { logger } from '../utils/logger.js';
import {
  emitAuthErrorAndDisconnect,
  scheduleTokenExpiryDisconnect,
  SOCKET_DISCONNECT_REASONS,
} from '../utils/socketSecurity.js';

function getBearerToken(header) {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7);
}

export function requireAuth(req, res, next) {
  const token = getBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    req.user = verifyToken(token);
    return next();
  } catch (err) {
    logger.warn('http token verification failed', { reason: err.name || 'jwt_error' });
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

export function socketAuth(requiredRole) {
  return (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      socket.emit('auth:error', {
        code: 'AUTH_REQUIRED',
        reason: SOCKET_DISCONNECT_REASONS.AUTH_FAILED,
        message: 'Authentication required.',
      });
      return next(new Error('Authentication required'));
    }

    try {
      const user = verifyToken(token);
      if (requiredRole && user.role !== requiredRole) {
        socket.emit('auth:error', {
          code: 'FORBIDDEN',
          reason: SOCKET_DISCONNECT_REASONS.AUTH_FAILED,
          message: 'Insufficient permissions.',
        });
        return next(new Error('Forbidden'));
      }
      socket.user = user;
      scheduleTokenExpiryDisconnect(socket, logger);
      return next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        emitAuthErrorAndDisconnect(socket, 'TOKEN_EXPIRED', SOCKET_DISCONNECT_REASONS.TOKEN_EXPIRED, logger);
        return next(new Error('Token expired'));
      }

      socket.emit('auth:error', {
        code: 'INVALID_TOKEN',
        reason: SOCKET_DISCONNECT_REASONS.AUTH_FAILED,
        message: 'Invalid or expired token.',
      });
      logger.warn('socket token verification failed', {
        namespace: socket.nsp?.name,
        socketId: socket.id,
        reason: err.name || 'jwt_error',
      });
      return next(new Error('Invalid or expired token'));
    }
  };
}
