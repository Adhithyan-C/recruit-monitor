import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'Supabase direct (non-pooled) connection string'),
  JWT_SECRET: z.string().min(32, 'Must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  AGORA_APP_ID: z.string().min(1),
  AGORA_APP_CERTIFICATE: z.string().min(1, 'Required for server-side token generation'),
  AGORA_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  DEEPGRAM_API_KEY: z.string().min(1),

  CLIENT_ORIGIN: z.string().min(1, 'Comma-separated list of allowed origins'),

  REDIS_URL: z.string().url(),

  GRACE_WINDOW_SECONDS: z.coerce.number().int().positive().default(30),
  CLAIM_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  PRESENCE_HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().positive().default(10),
  PRESENCE_STALE_AFTER_SECONDS: z.coerce.number().int().positive().default(30),
  PRESENCE_SWEEPER_INTERVAL_SECONDS: z.coerce.number().int().positive().default(15),

  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(60),

  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
});

const result = schema.safeParse(process.env);

if (!result.success) {
  const lines = result.error.issues.map(
    (i) => `  ${i.path.join('.')}: ${i.message}`
  );
  console.error(
    `[config] Missing or invalid environment variables:\n${lines.join('\n')}\n` +
      'See server/.env.example for the full list of required variables.'
  );
  process.exit(1);
}

export const env = result.data;
export type Env = typeof env;
