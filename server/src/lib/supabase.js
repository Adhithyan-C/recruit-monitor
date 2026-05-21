import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

/* =========================
   VALIDATE ENV VARIABLES
========================= */

const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY'
];

const missingVars = requiredEnvVars.filter((key) => {
  return !process.env[key];
});

if (missingVars.length > 0) {
  console.error(
    `ERROR: Missing Supabase environment variables: ${missingVars.join(', ')}`
  );

  throw new Error('Supabase configuration invalid');
}

/* =========================
   SHARED CLIENT OPTIONS
========================= */

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
};

/* =========================
   PUBLIC AUTH CLIENT
   Uses publishable/anon key
========================= */

export const supabaseAuth = createClient(
  config.supabase.url,
  config.supabase.anonKey,
  clientOptions
);

/* =========================
   ADMIN CLIENT
   Uses service role key
========================= */

export const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  clientOptions
);

/* =========================
   DEFAULT EXPORTS
========================= */

// General auth operations
export const supabase = supabaseAuth;

// Admin-level operations
export const supabaseService = supabaseAdmin;

console.log('Supabase clients initialized successfully');