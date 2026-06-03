import type { Socket } from 'socket.io';
import type { Pool } from 'pg';
import { verifyInternalJwt } from '../../auth/jwt.js';
import type { CandidateSocketData } from '../types.js';

/**
 * Socket.IO middleware for the /candidate namespace.
 *
 * Reads meetingId from handshake.auth.meetingId and verifies that the meeting
 * exists in a state that allows candidate connection (claimed → interrupted).
 *
 * Optionally reads handshake.auth.token: if present, verifies it as an internal
 * JWT and confirms the authenticated user matches meetings.candidate_id.
 * Anonymous joins (no token) are accepted — the meetingId alone acts as the credential.
 */
export function requireRoomCode(pool: Pool) {
  return async (
    socket: Socket & { data: CandidateSocketData },
    next: (err?: Error) => void,
  ): Promise<void> => {
    const { meetingId, token } = socket.handshake.auth as {
      meetingId?: string;
      token?: string;
    };

    if (!meetingId) {
      next(new Error('AUTH_ERROR: missing meetingId'));
      return;
    }

    try {
      const { rows } = await pool.query<{ id: string; candidate_id: string }>(
        `SELECT id, candidate_id
           FROM meetings
          WHERE id = $1
            AND status IN ('claimed', 'connecting', 'active', 'interrupted')`,
        [meetingId],
      );

      const meeting = rows[0];
      if (!meeting) {
        next(new Error('AUTH_ERROR: invalid room code'));
        return;
      }

      socket.data.meetingId = meetingId;

      if (token) {
        let decoded: ReturnType<typeof verifyInternalJwt>;
        try {
          decoded = verifyInternalJwt(token);
        } catch {
          next(new Error('AUTH_ERROR: invalid token'));
          return;
        }
        if (decoded.userId !== meeting.candidate_id) {
          next(new Error('AUTH_ERROR: token does not match meeting candidate'));
          return;
        }
        socket.data.userId = decoded.userId;
      }

      next();
    } catch (err) {
      next(err instanceof Error ? err : new Error('AUTH_ERROR: unexpected error'));
    }
  };
}
