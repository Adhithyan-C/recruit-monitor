import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { API_URL } from '../config.js';
import { useAuthStore } from '../store/useAuthStore.js';

export default function LoginPage() {
  const navigate = useNavigate();
  const login    = useAuthStore((s) => s.login);

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password.trim()) {
      setError('Please enter both email and password.');
      return;
    }

    setLoading(true);
    try {
      const { data, error: supaError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (supaError) throw supaError;

      const res = await fetch(`${API_URL}/auth/session`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to create session.');
      }
      const { token, user } = await res.json();

      login({ userId: user.id, email: user.email, name: user.name, role: user.role, language: user.language }, token);

      if (user.role === 'interviewer')     navigate('/interviewer');
      else if (user.role === 'supervisor') navigate('/supervisor');
      else                                 navigate('/candidate');
    } catch (err) {
      setError(err.message || 'Invalid email or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    // No py-12 on mobile; vertically centered on sm+
    <div className="flex-1 flex flex-col sm:items-center sm:justify-center sm:px-4 sm:py-8">
      <div className="w-full sm:max-w-md animate-fade-in">

        {/* Logo + title — sits above the edge-to-edge card on mobile */}
        <div className="text-center px-6 pt-10 pb-6 sm:px-0 sm:pt-0 sm:pb-0 sm:mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-md bg-primary-600 mb-4">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-surface-50 mb-1.5">RecruitMonitor</h1>
          <p className="text-sm text-surface-400">Interview Monitoring Platform</p>
        </div>

        {/* Card — edge-to-edge + square corners on mobile, max-width + rounded on sm+ */}
        <div className="glass-card rounded-none sm:rounded-lg p-6 sm:p-8">
          <h2 className="text-base font-semibold text-surface-200 mb-5">Sign in to your account</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-surface-300 mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="glass-input"
                autoComplete="email"
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-surface-300 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="glass-input"
                autoComplete="current-password"
                disabled={loading}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-danger-500/10 border border-danger-500/20 text-danger-400 text-sm animate-fade-in">
                <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in…
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        {/* Footer link — padded on mobile to match card content */}
        <div className="text-center px-6 py-5 sm:px-0 sm:mt-5">
          <p className="text-surface-400 text-sm">
            Don't have an account?{' '}
            <Link to="/register" className="text-primary-400 hover:text-primary-300 font-medium transition-colors">
              Create one →
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
