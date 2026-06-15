import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/authMiddleware.js';
import * as roomRegistry from '../state/roomRegistry.js';

const router = Router();

/**
 * Strips socket IDs from room objects before sending to clients.
 */
function sanitizeRoom(room) {
  const { interviewerSocketId, candidateSocketId, supervisorSocketId, ...safe } = room;
  return {
    ...safe,
    isMonitored: !!supervisorSocketId
  };
}

/**
 * GET /rooms/active
 * Supervisor-only: returns all active interview rooms.
 */
router.get('/active', requireAuth, requireRole('supervisor'), (req, res) => {
  const rooms = roomRegistry.getAllActiveRooms().map(sanitizeRoom);
  res.json({ rooms });
});

export default router;
