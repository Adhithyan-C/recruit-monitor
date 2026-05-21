import { io } from 'socket.io-client';
import { SOCKET_URL } from '../config.js';
import { useAuthStore } from '../store/useAuthStore.js';
import { tokenStorage } from '../utils/tokenStorage.js';

// Module-level singletons — survive component remounts
const sockets = {
  interviewer: null,
  candidate: null,
  supervisor: null
};

export function getSocket(role) {
  if (sockets[role]) return sockets[role];

  const token = useAuthStore.getState().token || tokenStorage.get();

  const opts = {
    autoConnect: true,
    auth: role !== 'candidate' ? { token } : undefined
  };

  sockets[role] = io(`${SOCKET_URL}/${role}`, opts);
  sockets[role].on('auth:error', () => {
    useAuthStore.getState().logout();
    disconnectAll();
  });
  sockets[role].on('connect_error', (err) => {
    if (role === 'candidate') return;
    const message = String(err?.message || '').toLowerCase();
    if (message.includes('token') || message.includes('auth') || message.includes('forbidden')) {
      useAuthStore.getState().logout();
      disconnectAll();
    }
  });
  return sockets[role];
}

export function disconnectSocket(role) {
  if (sockets[role]) {
    sockets[role].disconnect();
    sockets[role] = null;
  }
}

export function disconnectAll() {
  Object.keys(sockets).forEach(disconnectSocket);
}

// Hook wrapper for use in components
export function useSocket(role) {
  const socket = getSocket(role);
  return socket;
}
