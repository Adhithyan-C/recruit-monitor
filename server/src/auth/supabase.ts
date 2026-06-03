import { supabaseAdmin } from '../lib/supabase.js';
import { AuthError } from '../lib/errors.js';

export interface SupabaseUserInfo {
  id: string;
  email: string;
  name: string | null;
  role: string;
  language: string;
}

export async function verifySupabaseToken(token: string): Promise<SupabaseUserInfo> {
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    throw new AuthError('Invalid Supabase token');
  }

  const user = data.user;
  const email = user.email ?? '';
  const name =
    (user.user_metadata?.['full_name'] as string | undefined) ??
    (user.user_metadata?.['name'] as string | undefined) ??
    null;
  const role =
    (user.user_metadata?.['role'] as string | undefined) ?? 'candidate';
  const language =
    (user.user_metadata?.['language'] as string | undefined) ?? 'english';

  return { id: user.id, email, name, role, language };
}
