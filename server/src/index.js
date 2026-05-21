import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { config } from './config.js';
import authRoutes from './routes/auth.js';
import roomRoutes from './routes/rooms.js';
import { setupSockets } from './socket/index.js';
import { supabase } from './lib/supabase.js';

/* =========================
   VALIDATE ENV VARIABLES
========================= */

if (!config.jwtSecret) {
  throw new Error('JWT_SECRET is missing in .env');
}

if (!config.clientOrigin) {
  throw new Error('CLIENT_ORIGIN is missing in .env');
}

if (!process.env.SUPABASE_URL) {
  throw new Error('SUPABASE_URL is missing in .env');
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing in .env');
}

/* =========================
   CREATE EXPRESS APP
========================= */

const app = express();

const allowedOrigins = [
  config.clientOrigin,
  config.clientOriginProd
].filter(Boolean);

/* =========================
   SECURITY MIDDLEWARE
========================= */

app.use(helmet());

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());

/* =========================
   TEST ROUTE
========================= */

app.get('/test-route', (_, res) => {
  console.log('TEST ROUTE HIT');

  res.json({
    ok: true
  });
});

/* =========================
   TEST SUPABASE LOGIN ROUTE
   TEMPORARY DEBUG VERSION
========================= */

app.post('/test-login', async (req, res) => {
  console.log('TEST LOGIN ROUTE HIT');

  try {
    console.log('Request body:', req.body);

    const { email, password } = req.body;

    if (!email || !password) {
      console.log('Missing email or password');

      return res.status(400).json({
        error: 'Email and password are required'
      });
    }

    console.log('Attempting Supabase login...');

    const { data, error } =
      await supabase.auth.signInWithPassword({
        email,
        password
      });

    console.log('Supabase response received');

    if (error) {
      console.error('Supabase auth error:', error);

      return res.status(401).json({
        error: error.message
      });
    }

    console.log('Login successful');

    return res.json({
      success: true,
      user: data.user,
      session: data.session
    });

  } catch (err) {
    console.error('Test login crash:', err);

    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

/* =========================
   API ROUTES
========================= */

app.use('/auth', authRoutes);
app.use('/rooms', roomRoutes);

/* =========================
   HEALTH CHECK
========================= */

app.get('/health', (_, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

/* =========================
   CREATE HTTP SERVER
========================= */

const httpServer = http.createServer(app);

/* =========================
   SOCKET.IO SETUP
========================= */

setupSockets(httpServer, {
  cors: {
    origin: true,
    credentials: true
  }
});

/* =========================
   START SERVER
========================= */

httpServer.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
  console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
  console.log('Supabase integration initialized');
});