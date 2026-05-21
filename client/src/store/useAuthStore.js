import { create } from 'zustand';
import { tokenStorage } from '../utils/tokenStorage.js';

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

export const useAuthStore = create((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,

  login: (user, token) => {
    tokenStorage.set(token);
    set({ user, token, isAuthenticated: true });
  },

  logout: () => {
    tokenStorage.clear();
    set({ user: null, token: null, isAuthenticated: false });
  },

  rehydrate: () => {
    const token = tokenStorage.get();
    if (!token) return;

    const payload = parseJwt(token);
    if (!payload) {
      tokenStorage.clear();
      return;
    }

    // Check if token is expired
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      tokenStorage.clear();
      return;
    }

    set({
      user: {
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
        name: payload.name
      },
      token,
      isAuthenticated: true
    });
  }
}));
