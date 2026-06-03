import { create } from 'zustand';
import { tokenStorage } from '../utils/tokenStorage.js';
import { API_URL } from '../config.js';

function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (err) {
    console.warn('Failed to parse JWT:', err);
    return null;
  }
}

function userFromPayload(payload) {
  return {
    userId:   payload.userId,
    email:    payload.email,
    role:     payload.role,
    name:     payload.name ?? null,
    language: payload.language ?? null,
  };
}

export const useAuthStore = create((set) => ({
  user:            null,
  token:           null,
  isAuthenticated: false,
  // false until rehydrate() has run (sync) or tryRefresh() has settled (async).
  // AppInit gates route rendering on this flag to prevent the ProtectedRoute race.
  hydrated:        false,

  login: (user, token) => {
    tokenStorage.set(token);
    set({ user, token, isAuthenticated: true, hydrated: true });
  },

  logout: () => {
    tokenStorage.clear();
    set({ user: null, token: null, isAuthenticated: false, hydrated: true });
  },

  // Synchronous. Reads localStorage, sets auth if the stored token is valid.
  // Returns { expired: false } or { expired: true, expiredToken } so the
  // module-level boot block can decide whether to call tryRefresh().
  // In all non-expired paths, sets hydrated: true immediately.
  rehydrate: () => {
    const token = tokenStorage.get();
    if (!token) {
      set({ hydrated: true });
      return { expired: false };
    }

    const payload = parseJwt(token);
    if (!payload) {
      tokenStorage.clear();
      set({ hydrated: true });
      return { expired: false };
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      // Leave the token in storage — tryRefresh() needs to send it.
      // hydrated stays false until tryRefresh() settles.
      return { expired: true, expiredToken: token };
    }

    set({
      user:            userFromPayload(payload),
      token,
      isAuthenticated: true,
      hydrated:        true,
    });
    return { expired: false };
  },

  // Async. Called when rehydrate() finds an expired token.
  // Calls POST /auth/refresh; on success stores the new token and marks hydrated.
  // On any failure, clears the expired token and marks hydrated (unauthenticated).
  tryRefresh: async (expiredToken) => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${expiredToken}` },
      });
      if (!res.ok) throw new Error(`refresh ${res.status}`);
      const { token } = await res.json();
      const payload = parseJwt(token);
      if (!payload) throw new Error('bad token in refresh response');
      tokenStorage.set(token);
      set({
        user:            userFromPayload(payload),
        token,
        isAuthenticated: true,
        hydrated:        true,
      });
    } catch {
      tokenStorage.clear();
      set({ user: null, token: null, isAuthenticated: false, hydrated: true });
    }
  },
}));

// Synchronous self-hydration — runs at module load, before any React render.
// This eliminates the ProtectedRoute race: by the time routes render,
// isAuthenticated already reflects the stored token (if valid).
const _boot = useAuthStore.getState().rehydrate();
if (_boot.expired) {
  // Fire-and-forget: hydrated becomes true when the promise settles.
  // AppInit shows a spinner until then.
  useAuthStore.getState().tryRefresh(_boot.expiredToken);
}
