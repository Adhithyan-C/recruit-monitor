import express from 'express';
import rateLimit from 'express-rate-limit';
import { supabaseAuth } from '../lib/supabase.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { generateToken } from '../utils/generateToken.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const normalizedEmail = String(email).trim().toLowerCase();
    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error || !data?.user) {
      logger.warn('login failed');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const supabaseUser = data.user;
    const role = supabaseUser.user_metadata?.role;
    const name = supabaseUser.user_metadata?.name;

    if (!role || !['interviewer', 'supervisor'].includes(role)) {
      logger.warn('login rejected - no valid role');
      return res.status(403).json({ error: 'Access denied. Your account does not have platform access.' });
    }

    const resolvedName = name || normalizedEmail.split('@')[0];
    const token = generateToken({
      userId: supabaseUser.id,
      email: supabaseUser.email,
      role,
      name: resolvedName,
    });

    logger.info('login successful', { role });

    return res.json({
      success: true,
      token,
      user: {
        id: supabaseUser.id,
        email: supabaseUser.email,
        role,
        name: resolvedName,
      },
    });
  } catch (err) {
    logger.error('login error', { reason: err.message });
    return res.status(500).json({ error: 'Authentication service unavailable' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

export default router;
