import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/pool.js';
import { verifySupabaseToken } from '../auth/supabase.js';
import { issueInternalJwt, decodeExpiredJwt } from '../auth/jwt.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireAuth } from './middleware/requireAuth.js';
import { AuthError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const REFRESH_GRACE_MS = 60 * 60 * 1_000; // 1 hour

const authLimiter = rateLimit({
  windowMs: 60 * 1_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();
router.use(authLimiter);

// POST /auth/session — exchange a Supabase JWT for an internal JWT
router.post('/session', async (req: Request, res: Response) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization header', code: 'AUTH_ERROR' });
    return;
  }
  const supabaseToken = header.slice(7);

  const supabaseUser = await verifySupabaseToken(supabaseToken);

  const { rows } = await pool.query<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    org_id: string | null;
    language: string;
  }>(
    `INSERT INTO users (id, email, name, role, language)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE
       SET email = EXCLUDED.email,
           name  = EXCLUDED.name
     RETURNING id, email, name, role, org_id, language`,
    [supabaseUser.id, supabaseUser.email, supabaseUser.name, supabaseUser.role, supabaseUser.language]
  );

  const dbUser = rows[0]!;
  const token = issueInternalJwt({
    userId: dbUser.id,
    email: dbUser.email,
    role: dbUser.role,
    orgId: dbUser.org_id,
    language: dbUser.language,
  });

  logger.info({ userId: dbUser.id, role: dbUser.role }, 'session issued');
  res.json({ token, user: { id: dbUser.id, email: dbUser.email, name: dbUser.name, role: dbUser.role, language: dbUser.language } });
});

// POST /auth/refresh — reissue using an expired internal JWT (within 1-hour grace)
router.post('/refresh', async (req: Request, res: Response) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization header', code: 'AUTH_ERROR' });
    return;
  }
  const oldToken = header.slice(7);

  let decoded: ReturnType<typeof decodeExpiredJwt>;
  try {
    decoded = decodeExpiredJwt(oldToken);
  } catch {
    res.status(401).json({ error: 'Invalid token', code: 'AUTH_ERROR' });
    return;
  }

  if (Date.now() > decoded.exp * 1_000 + REFRESH_GRACE_MS) {
    res.status(401).json({ error: 'Refresh window expired', code: 'AUTH_ERROR' });
    return;
  }

  const { data, error } = await supabaseAdmin.auth.admin.getUserById(decoded.userId);
  if (error || !data.user) {
    throw new AuthError('Supabase user not found');
  }

  const { rows } = await pool.query<{
    id: string;
    email: string;
    role: string;
    org_id: string | null;
    language: string;
  }>('SELECT id, email, role, org_id, language FROM users WHERE id = $1', [decoded.userId]);

  if (rows.length === 0) {
    throw new AuthError('User not found');
  }

  const dbUser = rows[0]!;
  const token = issueInternalJwt({
    userId: dbUser.id,
    email: dbUser.email,
    role: dbUser.role,
    orgId: dbUser.org_id,
    language: dbUser.language,
  });

  logger.info({ userId: dbUser.id }, 'token refreshed');
  res.json({ token });
});

// GET /auth/me — return current user from the internal JWT
router.get('/me', requireAuth, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

export { router as authRouter };
