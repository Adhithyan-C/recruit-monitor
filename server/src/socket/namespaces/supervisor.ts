import type { Server } from 'socket.io';
import type { MeetingService, MeetingDetailsWithNames } from '../../domain/MeetingService.js';
import type { TranscriptService } from '../../domain/TranscriptService.js';
import { AgoraTokenService } from '../../domain/AgoraTokenService.js';
import type { SessionService } from '../../domain/SessionService.js';
import { pool } from '../../db/pool.js';
import { redis } from '../../db/redis.js';
import { requireJwtSocket } from '../middleware/requireJwtSocket.js';
import { attachReconnectSession } from '../middleware/attachReconnectSession.js';
import { joinRoomSchema } from '../schemas/supervisor.js';
import { NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import type { SupervisorSocket } from '../types.js';
import { onSafe } from '../safeHandler.js';
import { z } from 'zod';

export interface SupervisorDeps {
  meetingService: MeetingService;
  transcriptService: TranscriptService;
  agoraTokenService: AgoraTokenService;
  sessionService: SessionService;
}

const subscribeActiveMeetingsSchema = z.undefined();

export function registerSupervisorNamespace(io: Server, deps: SupervisorDeps): void {
  const { meetingService, transcriptService, agoraTokenService, sessionService } = deps;
  const nsp = io.of('/supervisor');

  nsp.use((socket, next) => requireJwtSocket(socket as SupervisorSocket, next, 'supervisor'));
  nsp.use((socket, next) => attachReconnectSession(sessionService)(socket, next));

  nsp.on('connection', (rawSocket) => {
    const socket = rawSocket as SupervisorSocket;
    const { userId, role } = socket.data.user;

    sessionService.create(userId)
      .then(({ reconnectToken, expiresAt }) => {
        socket.emit('session_established', { reconnectToken, expiresAt });
      })
      .catch((err) => logger.error({ err, userId }, 'session create failed'));

    logger.info({ socketId: socket.id, userId, role }, 'supervisor connected');

    onSafe(socket, {
      event: 'subscribe_active_meetings',
      schema: subscribeActiveMeetingsSchema,
      rateLimit: { limit: 20, windowMs: 60_000 },
    }, async (_payload, { ack }) => {
      await socket.join('meetings_monitor');
      const lang     = socket.data.user?.language ?? 'english';
      const cacheKey = `activemeetings:${lang}`;
      let meetings: MeetingDetailsWithNames[];
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          meetings = JSON.parse(cached) as MeetingDetailsWithNames[];
        } else {
          meetings = await meetingService.getActiveMeetingsWithNames(lang);
          await redis.set(cacheKey, JSON.stringify(meetings), 'EX', 5);
        }
      } catch (err) {
        logger.error({ err }, 'subscribe_active_meetings: cache failed, falling back to DB');
        meetings = await meetingService.getActiveMeetingsWithNames(lang);
      }
      ack({ ok: true, data: { meetings } });
      logger.debug({ userId, count: meetings.length, lang }, 'supervisor subscribed to active meetings');
    });

    onSafe(socket, {
      event: 'join_room',
      schema: joinRoomSchema,
      rateLimit: { limit: 30, windowMs: 60_000 },
    }, async ({ meetingId }, { ack }) => {
      // Language pre-flight — supervisors may only observe meetings whose candidate
      // shares their language, matching the same constraint applied to interviewers.
      try {
        const { rows: langRows } = await pool.query<{ language: string }>(
          `SELECT u.language
             FROM meetings m
             JOIN users u ON u.id = m.candidate_id
            WHERE m.id = $1`,
          [meetingId],
        );
        if (langRows.length > 0) {
          const candidateLang  = langRows[0]!.language;
          const supervisorLang = socket.data.user?.language ?? 'english';
          if (candidateLang !== supervisorLang) {
            ack({ ok: false, error: 'Language mismatch', code: 'FORBIDDEN' });
            return;
          }
        }
      } catch (err) {
        logger.error({ err, meetingId }, 'supervisor join_room: language pre-flight failed');
        ack({ ok: false, error: 'Internal error', code: 'INTERNAL_ERROR' });
        return;
      }

      try {
        const meeting = await meetingService.getMeeting(meetingId);
        const uid = AgoraTokenService.deriveUid(meetingId, userId);
        const agoraToken = agoraTokenService.generateToken({
          channelName: meeting.agoraChannel,
          uid,
          role: 'subscriber',
        });

        await socket.join(`meeting:${meetingId}`);

        const [segments, notes] = await Promise.all([
          transcriptService.getSegments(meetingId),
          transcriptService.getNotes(meetingId),
        ]);

        ack({ ok: true, data: {
          agoraToken,
          agoraChannel: meeting.agoraChannel,
          uid,
          segments,
          notes,
          participantUids: {
            interviewerUid: meeting.interviewerId
              ? AgoraTokenService.deriveUid(meetingId, meeting.interviewerId)
              : null,
            candidateUid: AgoraTokenService.deriveUid(meetingId, meeting.candidateId),
          },
        } });
        logger.info({ userId, meetingId }, 'supervisor joined meeting room');
      } catch (err) {
        if (err instanceof NotFoundError) {
          ack({ ok: false, error: 'Meeting not found', code: 'NOT_FOUND' });
        } else {
          logger.error({ err, meetingId }, 'supervisor join_room failed');
          ack({ ok: false, error: 'Internal error', code: 'INTERNAL_ERROR' });
        }
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info({ socketId: socket.id, userId, reason }, 'supervisor disconnected');
    });
  });
}
