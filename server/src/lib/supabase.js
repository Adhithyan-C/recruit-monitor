import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

if (!config.supabase.url || !config.supabase.anonKey || !config.supabase.serviceRoleKey) {
  console.error('ERROR: Missing Supabase configuration. Check SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

export const supabaseAuth = createClient(
  config.supabase.url,
  config.supabase.anonKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  }
);

export const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  }
);
