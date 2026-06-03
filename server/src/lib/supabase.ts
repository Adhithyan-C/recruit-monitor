import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
} as const;

export const supabaseAuth = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, clientOptions);
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, clientOptions);
