import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../../../src/http/middleware/requireAuth.js';
import { issueInternalJwt, type InternalJwtPayload } from '../../../src/auth/jwt.js';

const payload: InternalJwtPayload = {
  userId: 'user-456',
  email: 'user@example.com',
  role: 'interviewer',
  orgId: 'org-xyz',
};

function makeResMock() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

function makeReq(authorization?: string): Request {
  return {
    headers: authorization ? { authorization } : {},
  } as unknown as Request;
}

describe('requireAuth middleware', () => {
  it('sets req.user and calls next() for a valid token', () => {
    const token = issueInternalJwt(payload);
    const req = makeReq(`Bearer ${token}`);
    const res = makeResMock();
    const next = vi.fn() as unknown as NextFunction;

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user?.userId).toBe(payload.userId);
    expect(req.user?.role).toBe(payload.role);
  });

  it('returns 401 when Authorization header is missing', () => {
    const req = makeReq();
    const res = makeResMock();
    const next = vi.fn() as unknown as NextFunction;

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'AUTH_ERROR' }));
  });

  it('returns 401 when token is signed with wrong secret', () => {
    const alien = jwt.sign(payload, 'totally-different-secret-that-is-32-chars!!', {
      algorithm: 'HS256',
    });
    const req = makeReq(`Bearer ${alien}`);
    const res = makeResMock();
    const next = vi.fn() as unknown as NextFunction;

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'AUTH_ERROR' }));
  });

  it('returns 401 with TOKEN_EXPIRED code for an expired token', () => {
    const expired = jwt.sign(payload, process.env['JWT_SECRET']!, {
      algorithm: 'HS256',
      expiresIn: -1,
    });
    const req = makeReq(`Bearer ${expired}`);
    const res = makeResMock();
    const next = vi.fn() as unknown as NextFunction;

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_EXPIRED' }));
  });
});
