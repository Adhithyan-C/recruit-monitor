import type { Request, Response, NextFunction } from 'express';
import { verifyInternalJwt } from '../../auth/jwt.js';
import { AuthError, ForbiddenError } from '../../lib/errors.js';

function extractBearer(req: Request): string {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new AuthError('Missing Authorization header');
  return header.slice(7);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  try {
    const token = extractBearer(req);
    req.user = verifyInternalJwt(token);
    next();
  } catch (err) {
    if (err instanceof Error && err.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
      return;
    }
    res.status(401).json({ error: 'Unauthorized', code: 'AUTH_ERROR' });
  }
}

export function requireRole(role: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized', code: 'AUTH_ERROR' });
      return;
    }
    if (req.user.role !== role) {
      const err = new ForbiddenError(`Requires role: ${role}`);
      res.status(403).json({ error: err.message, code: err.code });
      return;
    }
    next();
  };
}
