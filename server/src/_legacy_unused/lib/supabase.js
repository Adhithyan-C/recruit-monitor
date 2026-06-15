import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const missingSupabaseConfig = [
  ['SUPABASE_URL', config.supabase.url],
  ['SUPABASE_ANON_KEY', config.supabase.anonKey],
  ['SUPABASE_SERVICE_ROLE_KEY', config.supabase.serviceRoleKey],
].filter(([, value]) => !value).map(([key]) => key);

if (missingSupabaseConfig.length > 0) {
  logger.error('missing required Supabase environment variables', { variables: missingSupabaseConfig });
  process.exit(1);
}

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
};

export const supabaseAuth = createClient(
  config.supabase.url,
  config.supabase.anonKey,
  clientOptions
);

export const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  clientOptions
);
