import express from 'express';
import jwt from 'jsonwebtoken';
import { supabaseAuth } from '../lib/supabase.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error || !data?.user) {
      console.warn(`[Auth] Failed login attempt for: ${normalizedEmail}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const supabaseUser = data.user;
    const role = supabaseUser.user_metadata?.role;
    const name = supabaseUser.user_metadata?.name;

    if (!role || !['interviewer', 'supervisor'].includes(role)) {
      console.warn(`[Auth] Login rejected - no valid role for user: ${normalizedEmail}`);
      return res.status(403).json({ error: 'Access denied. Your account does not have platform access.' });
    }

    const resolvedName = name || normalizedEmail.split('@')[0];
    const token = jwt.sign(
      {
        userId: supabaseUser.id,
        email: supabaseUser.email,
        role,
        name: resolvedName,
      },
      config.jwtSecret,
      { expiresIn: '8h' }
    );

    console.log(`[Auth] Successful login: ${normalizedEmail} (${role})`);

    return res.json({
      token,
      user: {
        userId: supabaseUser.id,
        email: supabaseUser.email,
        role,
        name: resolvedName,
      },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    return res.status(500).json({ error: 'Authentication service unavailable' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

export default router;
