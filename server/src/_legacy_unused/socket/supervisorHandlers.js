import { enforceRateLimit } from '../utils/socketRateLimiter.js';
import { logger } from '../utils/logger.js';
import { isActiveRoom } from '../utils/socketSecurity.js';

export function setupSupervisorHandlers(
  interviewerNS, candidateNS, supervisorNS,
  broadcastToRoom, broadcastActiveRoomUpdate,
  roomRegistry, sanitizeRoom, rateLimiter
) {
  supervisorNS.on('connection', (socket) => {
    logger.info('supervisor connected', {
      namespace: '/supervisor',
      socketId: socket.id,
      userId: socket.user?.userId,
    });

    const rooms = roomRegistry.getAllActiveRooms().map(sanitizeRoom);
    socket.emit('supervisor:active-rooms', { rooms });

    socket.on('supervisor:join-room', ({ roomId } = {}) => {
      if (!enforceRateLimit({
        socket,
        limiter: rateLimiter,
        event: 'supervisor:join-room',
        roomId,
        logger,
        namespace: '/supervisor',
      })) return;

      const room = roomRegistry.getRoomById(roomId);
      if (!isActiveRoom(room)) {
        socket.emit('error:room', { message: 'Room not found.' });
        return;
      }
      if (room.supervisorSocketId && room.supervisorSocketId !== socket.id) {
        socket.emit('error:room', { message: 'Another supervisor is already monitoring this interview.' });
        return;
      }

      const prev = roomRegistry.getRoomBySocketId(socket.id);
      if (prev && prev.roomId !== roomId) {
        roomRegistry.updateRoom(prev.roomId, { supervisorSocketId: null });
        socket.leave(prev.roomId);
      }

      roomRegistry.updateRoom(roomId, { supervisorSocketId: socket.id });
      socket.join(roomId);
      socket.emit('transcript:broadcast', { text: room.transcriptText });

      logger.info('supervisor joined room', {
        namespace: '/supervisor',
        socketId: socket.id,
        userId: socket.user?.userId,
        roomId,
      });
      broadcastActiveRoomUpdate();
    });

    socket.on('supervisor:leave-room', () => {
      const room = roomRegistry.getRoomBySocketId(socket.id);
      if (!room || room.supervisorSocketId !== socket.id) return;

      logger.info('supervisor left room', {
        namespace: '/supervisor',
        socketId: socket.id,
        userId: socket.user?.userId,
        roomId: room.roomId,
      });
      roomRegistry.updateRoom(room.roomId, { supervisorSocketId: null });
      socket.leave(room.roomId);
      broadcastActiveRoomUpdate();
    });

    socket.on('disconnect', (reason) => {
      logger.info('supervisor disconnected', {
        namespace: '/supervisor',
        socketId: socket.id,
        userId: socket.user?.userId,
        reason,
      });
      rateLimiter.cleanupSocket(socket.id);

      const room = roomRegistry.getRoomBySocketId(socket.id);
      if (room && room.supervisorSocketId === socket.id) {
        roomRegistry.updateRoom(room.roomId, { supervisorSocketId: null });
        broadcastActiveRoomUpdate();
      }
    });
  });
}
