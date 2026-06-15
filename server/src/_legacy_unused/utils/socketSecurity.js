import { MAX_AUDIO_CHUNK_SIZE } from '../services/deepgram/DeepgramSession.js';

const ROOM_CODE_REGEX = /^[A-Z2-9]{6}$/;

export const SOCKET_DISCONNECT_REASONS = {
  TOKEN_EXPIRED: 'token_expired',
  AUTH_FAILED: 'auth_failed',
};

export function scheduleTokenExpiryDisconnect(socket, logger) {
  const exp = socket.user?.exp;
  if (!exp) return null;

  const delay = (exp * 1000) - Date.now();
  if (delay <= 0) {
    emitAuthErrorAndDisconnect(socket, 'TOKEN_EXPIRED', SOCKET_DISCONNECT_REASONS.TOKEN_EXPIRED, logger);
    return null;
  }

  const timer = setTimeout(() => {
    emitAuthErrorAndDisconnect(socket, 'TOKEN_EXPIRED', SOCKET_DISCONNECT_REASONS.TOKEN_EXPIRED, logger);
  }, delay);
  timer.unref?.();
  socket.once('disconnect', () => clearTimeout(timer));
  return timer;
}

export function emitAuthErrorAndDisconnect(socket, code, reason, logger) {
  logger?.warn('socket auth disconnect', {
    namespace: socket.nsp?.name,
    socketId: socket.id,
    userId: socket.user?.userId,
    reason,
  });
  socket.emit('auth:error', {
    code,
    reason,
    message: code === 'TOKEN_EXPIRED' ? 'Session expired. Please sign in again.' : 'Authentication failed.',
  });
  socket.disconnect(true);
}

export function normalizeRoomCode(roomCode) {
  const normalized = String(roomCode || '').trim().toUpperCase();
  return ROOM_CODE_REGEX.test(normalized) ? normalized : null;
}

export function normalizeDisplayName(name) {
  return String(name || '').trim().slice(0, 100);
}

export function isActiveRoom(room) {
  return !!room && room.status !== 'ended';
}

export function isCandidateSocketForRoom(socket, room) {
  return socket.data?.role === 'candidate' &&
    socket.data?.roomId === room?.roomId &&
    room?.candidateSocketId === socket.id;
}

export function isValidAudioChunk(data) {
  if (!Buffer.isBuffer(data) && !(data instanceof Uint8Array)) return false;
  if (data.byteLength === 0 || data.byteLength > MAX_AUDIO_CHUNK_SIZE) return false;
  return data.byteLength % 2 === 0;
}
