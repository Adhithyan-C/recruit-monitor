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

export function getSocket(role) {
  if (sockets[role]) return sockets[role];

  const token         = useAuthStore.getState().token || tokenStorage.get();
  const reconnectToken = reconnectStorage.get(role);

  // All three namespaces now require JWT. The reconnect_token is optional —
  // server's attachReconnectSession middleware silently ignores it if missing/expired.
  const auth = { token };
  if (reconnectToken) auth.reconnect_token = reconnectToken;

  const socket = io(`${SOCKET_URL}/${role}`, { autoConnect: true, auth });

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

  // Auth failures trigger connect_error (requireJwtSocket calls next(err)).
  socket.on('connect_error', (err) => {
    const message = String(err?.message ?? '').toLowerCase();
    if (message.includes('token') || message.includes('auth') || message.includes('forbidden')) {
      useAuthStore.getState().logout();
      disconnectAll();
    }
  });

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
