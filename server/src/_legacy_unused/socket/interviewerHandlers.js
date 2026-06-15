import { enforceRateLimit } from '../utils/socketRateLimiter.js';
import { logger } from '../utils/logger.js';

export function setupInterviewerHandlers(
  interviewerNS, candidateNS, supervisorNS,
  broadcastToRoom, broadcastActiveRoomUpdate,
  roomRegistry, sanitizeRoom, deepgramManager, rateLimiter
) {
  interviewerNS.on('connection', (socket) => {
    logger.info('interviewer connected', {
      namespace: '/interviewer',
      socketId: socket.id,
      userId: socket.user?.userId,
    });

    socket.on('interviewer:create-room', ({ interviewerName } = {}) => {
      if (!enforceRateLimit({
        socket,
        limiter: rateLimiter,
        event: 'interviewer:create-room',
        logger,
        namespace: '/interviewer',
      })) return;

      const existing = roomRegistry.getRoomBySocketId(socket.id);
      if (existing) {
        deepgramManager.stopSession(existing.roomId);
        rateLimiter.cleanupRoom(existing.roomId);
        roomRegistry.terminateRoom(existing.roomId);
        broadcastToRoom(existing.roomId, 'room:terminated', { reason: 'Interviewer created a new room' });
        broadcastActiveRoomUpdate();
      }

      const safeName = String(interviewerName || socket.user?.name || 'Interviewer').trim().slice(0, 100);
      const room = roomRegistry.createRoom(socket.id, safeName);
      socket.join(room.roomId);

      socket.emit('room:created', {
        roomId: room.roomId,
        roomCode: room.roomCode,
        rtcChannelName: room.rtcChannelName,
      });

      logger.info('room created', {
        namespace: '/interviewer',
        socketId: socket.id,
        userId: socket.user?.userId,
        roomId: room.roomId,
      });
      broadcastActiveRoomUpdate();
    });

    socket.on('transcript:update', ({ roomId, text } = {}) => {
      const room = roomRegistry.getRoomById(roomId);
      if (!room || room.interviewerSocketId !== socket.id || room.status === 'ended') return;
      if (!enforceRateLimit({
        socket,
        limiter: rateLimiter,
        event: 'transcript:update',
        roomId,
        logger,
        namespace: '/interviewer',
      })) return;
      if (typeof text !== 'string') return;

      roomRegistry.updateRoom(roomId, { transcriptText: text });
      broadcastToRoom(roomId, 'transcript:broadcast', { text, source: 'manual' });
    });

    socket.on('interviewer:leave', () => {
      const room = roomRegistry.getRoomBySocketId(socket.id);
      if (!room) return;

      logger.info('interviewer leaving room', {
        namespace: '/interviewer',
        socketId: socket.id,
        userId: socket.user?.userId,
        roomId: room.roomId,
      });
      deepgramManager.stopSession(room.roomId);
      rateLimiter.cleanupRoom(room.roomId);
      roomRegistry.terminateRoom(room.roomId);
      broadcastToRoom(room.roomId, 'room:terminated', { reason: 'Interviewer ended the session' });
      broadcastActiveRoomUpdate();
    });

    socket.on('disconnect', (reason) => {
      logger.info('interviewer disconnected', {
        namespace: '/interviewer',
        socketId: socket.id,
        userId: socket.user?.userId,
        reason,
      });
      rateLimiter.cleanupSocket(socket.id);

      const room = roomRegistry.getRoomBySocketId(socket.id);
      if (!room) return;
      deepgramManager.stopSession(room.roomId);
      rateLimiter.cleanupRoom(room.roomId);
      roomRegistry.terminateRoom(room.roomId);
      broadcastToRoom(room.roomId, 'room:terminated', { reason: 'Interviewer disconnected' });
      broadcastActiveRoomUpdate();
    });
  });
}
