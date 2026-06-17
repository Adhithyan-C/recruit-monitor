import { io } from 'socket.io-client';
import { SOCKET_URL } from '../config.js';
import { useAuthStore } from '../store/useAuthStore.js';
import { tokenStorage } from '../utils/tokenStorage.js';

// Module-level singletons — survive component remounts.
const sockets = {
  interviewer: null,
  candidate:   null,
  supervisor:  null,
};

// Per-role reconnect tokens, persisted across page loads within the session.
// Stored separately from the JWT so clearing one doesn't affect the other.
const reconnectStorage = {
  get(role)        { return sessionStorage.getItem(`reconnect_token:${role}`) ?? undefined; },
  set(role, token) { sessionStorage.setItem(`reconnect_token:${role}`, token); },
  clear(role)      { sessionStorage.removeItem(`reconnect_token:${role}`); },
};

const attachedMeetingStorage = {
  get(role) {
    const raw = sessionStorage.getItem(`attached_meeting:${role}`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },
  set(role, payload) { sessionStorage.setItem(`attached_meeting:${role}`, JSON.stringify(payload)); },
  clear(role) { sessionStorage.removeItem(`attached_meeting:${role}`); },
};

// ── Proactive token refresh ───────────────────────────────────────────
// Reads the exp claim from a JWT without verifying the signature.
function parseJwtExp(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))?.exp ?? null;
  } catch { return null; }
}

let proactiveRefreshTimer = null;

function startProactiveRefresh() {
  if (proactiveRefreshTimer) return;
  proactiveRefreshTimer = setInterval(async () => {
    const { token, isAuthenticated } = useAuthStore.getState();
    if (!token || !isAuthenticated) return;
    const exp = parseJwtExp(token);
    if (exp === null) return;
    if (exp * 1000 - Date.now() < 3 * 60 * 1000) {
      await useAuthStore.getState().tryRefresh(token);
      const { token: newToken } = useAuthStore.getState();
      if (newToken) {
        for (const s of Object.values(sockets)) {
          if (s) s.auth.token = newToken;
        }
      }
    }
  }, 10 * 60 * 1000);
}

function stopProactiveRefresh() {
  if (proactiveRefreshTimer) {
    clearInterval(proactiveRefreshTimer);
    proactiveRefreshTimer = null;
  }
}

// Tracks sockets that have attempted a token refresh in the current failure
// episode. Cleared on successful connect so future failures each get one attempt.
const refreshAttempted = new WeakSet();

export function getSocket(role) {
  if (sockets[role]) return sockets[role];

  const token          = useAuthStore.getState().token || tokenStorage.get();
  const reconnectToken = reconnectStorage.get(role);

  // All three namespaces now require JWT. The reconnect_token is optional —
  // server's attachReconnectSession middleware silently ignores it if missing/expired.
  const auth = { token };
  if (reconnectToken) auth.reconnect_token = reconnectToken;

  const socket = io(`${SOCKET_URL}/${role}`, { autoConnect: true, auth });

  // Reset the refresh flag on successful connect so a future expiry episode
  // gets exactly one refresh attempt.
  socket.on('connect', () => {
    refreshAttempted.delete(socket);
  });

  // Server issues a fresh one-shot reconnect token on every connect.
  // Persist it and update socket.auth so it's sent on auto-reconnect.
  socket.on('session_established', ({ reconnectToken: newToken }) => {
    reconnectStorage.set(role, newToken);
    socket.auth.reconnect_token = newToken;
  });

  // Another tab or device connected with the same identity — this session is evicted.
  socket.on('session_replaced', () => {
    reconnectStorage.clear(role);
    attachedMeetingStorage.clear(role);
    disconnectAll();
    useAuthStore.getState().logout();
  });

  socket.on('meeting_attached', (payload) => {
    attachedMeetingStorage.set(role, payload);
  });

  // Auth failures: attempt one token refresh before logging out.
  // A second auth error after a successful refresh is a genuine failure → logout.
  // Handles the case where the 15m JWT expired while the socket was reconnecting.
  socket.on('connect_error', async (err) => {
    try {
      const message = String(err?.message ?? '').toLowerCase();
      if (!message.includes('token') && !message.includes('auth') &&
          !message.includes('forbidden') && !message.includes('expired')) return;

      if (refreshAttempted.has(socket)) {
        // Already tried refresh this episode — genuine auth failure.
        useAuthStore.getState().logout();
        disconnectAll();
        return;
      }

      const { token: currentToken } = useAuthStore.getState();
      if (!currentToken) {
        useAuthStore.getState().logout();
        disconnectAll();
        return;
      }

      refreshAttempted.add(socket);
      await useAuthStore.getState().tryRefresh(currentToken);
      const { token: newToken, isAuthenticated } = useAuthStore.getState();

      if (isAuthenticated && newToken) {
        // Propagate the fresh token to all active sockets before reconnecting.
        for (const s of Object.values(sockets)) {
          if (s) s.auth.token = newToken;
        }
        socket.connect();
        return;
      }

      // tryRefresh cleared the store — hard auth failure.
      useAuthStore.getState().logout();
      disconnectAll();
    } catch {
      useAuthStore.getState().logout();
      disconnectAll();
    }
  });

  startProactiveRefresh();
  sockets[role] = socket;
  return socket;
}

// Intentional disconnect — clears the reconnect token so the next connect is fresh.
export function disconnectSocket(role) {
  if (sockets[role]) {
    reconnectStorage.clear(role);
    attachedMeetingStorage.clear(role);
    sockets[role].disconnect();
    sockets[role] = null;
  }
}

export function disconnectAll() {
  stopProactiveRefresh();
  ['interviewer', 'candidate', 'supervisor'].forEach(disconnectSocket);
}

// Hook wrapper for component use.
export function useSocket(role) {
  return getSocket(role);
}

export function getAttachedMeeting(role) {
  return attachedMeetingStorage.get(role);
}

export function clearAttachedMeeting(role) {
  attachedMeetingStorage.clear(role);
}
