import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface InternalJwtPayload {
  userId: string;
  email: string;
  role: string;
  orgId: string | null;
  language: string;
}

export function issueInternalJwt(payload: InternalJwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function verifyInternalJwt(token: string): InternalJwtPayload & { exp: number; iat: number } {
  const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
  return decoded as InternalJwtPayload & { exp: number; iat: number };
}

export function decodeExpiredJwt(token: string): InternalJwtPayload & { exp: number; iat: number } {
  const decoded = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ['HS256'],
    ignoreExpiration: true,
  });
  return decoded as InternalJwtPayload & { exp: number; iat: number };
}
