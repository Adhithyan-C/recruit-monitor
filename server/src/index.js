import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { config } from './config.js';
import authRoutes from './routes/auth.js';
import roomRoutes from './routes/rooms.js';
import { setupSockets } from './socket/index.js';
import { logger } from './utils/logger.js';

const requiredEnv = [
  ['JWT_SECRET', config.jwtSecret],
  ['SUPABASE_URL', config.supabase.url],
  ['SUPABASE_ANON_KEY', config.supabase.anonKey],
  ['SUPABASE_SERVICE_ROLE_KEY', config.supabase.serviceRoleKey],
];

const missingEnv = requiredEnv.filter(([, value]) => !value).map(([key]) => key);
if (missingEnv.length > 0) {
  logger.error('missing required environment variables', { variables: missingEnv });
  process.exit(1);
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

app.use(express.json({ limit: '1mb' }));

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
  logger.info('server started', {
    port: config.port,
    allowedOrigins,
  });
});
