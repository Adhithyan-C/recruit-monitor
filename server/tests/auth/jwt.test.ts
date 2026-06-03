import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { issueInternalJwt, verifyInternalJwt, decodeExpiredJwt, type InternalJwtPayload } from '../../src/auth/jwt.js';

const payload: InternalJwtPayload = {
  userId: 'user-123',
  email: 'test@example.com',
  role: 'interviewer',
  orgId: 'org-abc',
};

describe('issueInternalJwt / verifyInternalJwt', () => {
  it('roundtrip: issued token verifies and contains correct payload', () => {
    const token = issueInternalJwt(payload);
    const decoded = verifyInternalJwt(token);

    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.email).toBe(payload.email);
    expect(decoded.role).toBe(payload.role);
    expect(decoded.orgId).toBe(payload.orgId);
    expect(typeof decoded.exp).toBe('number');
    expect(typeof decoded.iat).toBe('number');
  });

  it('verifyInternalJwt throws when signed with wrong secret', () => {
    const alien = jwt.sign(payload, 'totally-different-secret-that-is-32-chars!!', {
      algorithm: 'HS256',
    });
    expect(() => verifyInternalJwt(alien)).toThrow();
  });

  it('verifyInternalJwt throws TokenExpiredError for an expired token', () => {
    const expired = jwt.sign(payload, process.env['JWT_SECRET']!, {
      algorithm: 'HS256',
      expiresIn: -1,
    });
    expect(() => verifyInternalJwt(expired)).toThrow(
      expect.objectContaining({ name: 'TokenExpiredError' })
    );
  });
});

describe('decodeExpiredJwt', () => {
  it('succeeds on an expired token and returns payload', () => {
    const expired = jwt.sign(payload, process.env['JWT_SECRET']!, {
      algorithm: 'HS256',
      expiresIn: -1,
    });
    const decoded = decodeExpiredJwt(expired);
    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.email).toBe(payload.email);
  });

  it('still throws on wrong secret even with ignoreExpiration', () => {
    const alien = jwt.sign(payload, 'totally-different-secret-that-is-32-chars!!', {
      algorithm: 'HS256',
      expiresIn: -1,
    });
    expect(() => decodeExpiredJwt(alien)).toThrow();
  });
});
