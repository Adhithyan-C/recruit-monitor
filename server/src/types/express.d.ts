import type { InternalJwtPayload } from '../auth/jwt.js';

declare global {
  namespace Express {
    interface Request {
      user?: InternalJwtPayload & { exp: number; iat: number };
    }
  }
}

export {};
