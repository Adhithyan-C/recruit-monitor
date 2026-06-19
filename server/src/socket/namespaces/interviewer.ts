import type { Server } from 'socket.io';
import type { MeetingService } from '../../domain/MeetingService.js';
import type { PresenceService } from '../../domain/PresenceService.js';
import { AgoraTokenService } from '../../domain/AgoraTokenService.js';
import type { TranscriptService } from '../../domain/TranscriptService.js';
import type { SessionService } from '../../domain/SessionService.js';
import type { BroadcastHelper } from '../broadcast.js';
import { requireJwtSocket } from '../middleware/requireJwtSocket.js';
import { attachReconnectSession } from '../middleware/attachReconnectSession.js';
import {
  subscribeOpenRoomsSchema,
  joinOpenMeetingSchema,
  joinRoomSchema,
  endMeetingSchema,
  addNoteSchema,
  updateNoteSchema,
  deleteNoteSchema,
} from '../schemas/interviewer.js';
import { shareVideoSchema, videoSyncSchema, approveVideoSchema } from '../schemas/video.js';
import { ForbiddenError, InvalidTransitionError, NotFoundError, ConflictError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import type { InterviewerSocket } from '../types.js';
import { onSafe } from '../safeHandler.js';
import { pool } from '../../db/pool.js';
import { supabaseAdmin } from '../../lib/supabase.js';

const VIDEO_BUCKET = 'interview-videos';

export interface InterviewerDeps {
  meetingService: MeetingService;
  presenceService: PresenceService;
  agoraTokenService: AgoraTokenService;
  transcriptService: TranscriptService;
  sessionService: SessionService;
  broadcast: BroadcastHelper;
  io: Server;
}

export function registerInterviewerNamespace(io: Server, deps: InterviewerDeps): void {
  const {
    meetingService,
    agoraTokenService,
    transcriptService,
    sessionService,
    broadcast,
  } = deps;
  const nsp = io.of('/interviewer');

  nsp.use((socket, next) => requireJwtSocket(socket as InterviewerSocket, next, 'interviewer'));
  nsp.use((socket, next) => attachReconnectSession(sessionService)(socket, next));

  nsp.on('connection', async (rawSocket) => {
    const socket = rawSocket as InterviewerSocket;
    const { userId, role } = socket.data.user;

    await socket.join(`user:${userId}`);

    const existingSockets = await nsp.in(`user:${userId}`).fetchSockets();
    for (const old of existingSockets) {
      if (old.id !== socket.id) {
        old.emit('session_replaced', {});
        old.disconnect(true);
      }
    }

    sessionService.create(userId)
      .then(({ reconnectToken, expiresAt }) => {
        socket.emit('session_established', { reconnectToken, expiresAt });
      })
      .catch((err) => logger.error({ err, userId }, 'session create failed'));

    // Register ALL listeners before any await so events emitted during async
    // initialization (e.g. resumeOrAttachCurrentMeeting) are not silently
    // dropped by Socket.IO. Handlers that need socket.data.meetingId read it
    // at call time, not at registration time, so this reordering is safe.

    // ── Open rooms subscription ───────────────────────────────────────────

    onSafe(socket, {
      event: 'subscribe_open_rooms',
      schema: subscribeOpenRoomsSchema,
      rateLimit: { limit: 20, windowMs: 60_000 },
    }, async (_payload, { ack }) => {
      await socket.join('open_rooms_monitor');
      const lang = socket.data.user?.language ?? 'english';
      const meetings = await meetingService.getOpenMeetingsWithNames(lang);
      logger.info({ userId, socketId: socket.id, roomCount: meetings.length, lang }, 'subscribe_open_rooms: returning rooms');
      ack({ ok: true, data: { meetings } });
    });

    // ── Join an open solo room ────────────────────────────────────────────

    onSafe(socket, {
      event: 'join_open_meeting',
      schema: joinOpenMeetingSchema,
      rateLimit: { limit: 10, windowMs: 60_000 },
    }, async ({ meetingId }, { ack }) => {
      // Language pre-flight — belt-and-suspenders guard against race conditions.
      // The open rooms list is already language-filtered; this catches stale joins.
      try {
        const { rows: langRows } = await pool.query<{ language: string }>(
          `SELECT u.language
             FROM meetings m
             JOIN users u ON u.id = m.candidate_id
            WHERE m.id = $1 AND m.status = 'open'`,
          [meetingId],
        );
        if (langRows.length > 0) {
          const candidateLang   = langRows[0]!.language;
          const interviewerLang = socket.data.user?.language ?? 'english';
          if (candidateLang !== interviewerLang) {
            ack({ ok: true });
            return;
          }
        }
      } catch (err) {
        logger.error({ err, meetingId }, 'join_open_meeting: language pre-flight failed');
        ack({ ok: false, error: 'Internal error', code: 'INTERNAL_ERROR' });
        return;
      }

      try {
        const { agoraChannel, candidateId, interviewerName } = await meetingService.onInterviewerJoin(meetingId, userId);

        const uid          = AgoraTokenService.deriveUid(meetingId, userId);
        const candidateUid = AgoraTokenService.deriveUid(meetingId, candidateId);
        const agoraToken   = agoraTokenService.generateToken({
          channelName: agoraChannel,
          uid,
          role: 'publisher',
        });

        socket.data.meetingId = meetingId;
        await socket.join(`meeting:${meetingId}`);

        // Notify the candidate in the room that the meeting is now active.
        // Include interviewer name and UIDs so the candidate can resolve the video tile label.
        broadcast.meetingStatus(meetingId, 'active', {
          interviewerName,
          participantUids: { interviewerUid: uid, candidateUid },
        });

        // Remove this room from the open rooms list on all interviewer dashboards.
        broadcast.openRoomsUpdate()
          .catch((err) => logger.error({ err }, 'openRoomsUpdate after join_open_meeting failed'));

        // Update candidate socket's cached status so audio_chunk allows through immediately.
        io.of('/candidate').in(`meeting:${meetingId}`).fetchSockets()
          .then((sockets) => { for (const cs of sockets) cs.data.meetingStatus = 'active'; })
          .catch((err) => logger.error({ err, meetingId }, 'failed to update candidate meetingStatus on interviewer join'));

        const activeVideo = await meetingService.getActiveVideoForCandidate(candidateId)
          .catch((err) => { logger.error({ err, meetingId }, 'getActiveVideoForCandidate failed'); return null; });

        socket.emit('meeting_attached', {
          meetingId,
          status:        'active',
          agoraChannel,
          agoraToken,
          uid,
          candidateId,
          interviewerId: userId,
          participantUids: { interviewerUid: uid, candidateUid },
          activeVideo,
        });

        ack({ ok: true });
        logger.info({ userId, meetingId }, 'interviewer joined open meeting');
      } catch (err) {
        if (err instanceof InvalidTransitionError) {
          ack({ ok: false, error: 'Room is no longer available', code: 'CONFLICT' });
        } else if (err instanceof NotFoundError) {
          ack({ ok: false, error: 'Meeting not found', code: 'NOT_FOUND' });
        } else {
          logger.error({ err, meetingId }, 'join_open_meeting failed');
          ack({ ok: false, error: 'Internal error', code: 'INTERNAL_ERROR' });
        }
      }
    });

    // ── Legacy join_room (reconnect path for existing active/interrupted meetings) ──

    onSafe(socket, {
      event: 'join_room',
      schema: joinRoomSchema,
      rateLimit: { limit: 20, windowMs: 60_000 },
    }, async ({ meetingId }, { ack }) => {
      try {
        const meeting = await meetingService.getMeeting(meetingId);
        if (meeting.interviewerId !== userId) {
          ack({ ok: false, error: 'Meeting not found', code: 'NOT_FOUND' });
          return;
        }

        const uid = AgoraTokenService.deriveUid(meetingId, userId);
        const agoraToken = agoraTokenService.generateToken({
          channelName: meeting.agoraChannel,
          uid,
          role: 'publisher',
        });

        socket.data.meetingId = meetingId;
        await socket.join(`meeting:${meetingId}`);

        if (meeting.status === 'connecting') {
          try {
            await meetingService.onBothConnected(meetingId);
            broadcast.meetingStatus(meetingId, 'active');
          } catch (err) {
            if (!(err instanceof InvalidTransitionError)) throw err;
            logger.debug({ meetingId }, 'join_room: onBothConnected race, already active');
          }
        }

        ack({ ok: true, data: {
          agoraToken,
          agoraChannel: meeting.agoraChannel,
          uid,
          participantUids: {
            interviewerUid: AgoraTokenService.deriveUid(meetingId, userId),
            candidateUid:   AgoraTokenService.deriveUid(meetingId, meeting.candidateId),
          },
        } });
        logger.info({ userId, meetingId }, 'interviewer joined meeting room (legacy)');
      } catch (err) {
        if (err instanceof NotFoundError) ack({ ok: false, error: 'Meeting not found', code: 'NOT_FOUND' });
        else {
          logger.error({ err, meetingId }, 'join_room failed');
          ack({ ok: false, error: 'Internal error', code: 'INTERNAL_ERROR' });
        }
      }
    });

    // ── End meeting ───────────────────────────────────────────────────────

    onSafe(socket, {
      event: 'end_meeting',
      schema: endMeetingSchema,
      rateLimit: { limit: 10, windowMs: 60_000 },
    }, async ({ meetingId, reason }, { ack }) => {
      try {
        const meeting = await meetingService.getMeeting(meetingId);
        if (meeting.interviewerId !== userId) {
          ack({ ok: false, error: 'Meeting not found', code: 'NOT_FOUND' });
          return;
        }

        await meetingService.endMeeting(meetingId, reason);
        broadcast.meetingStatus(meetingId, 'ended');

        // Stop candidate audio immediately — no need to wait for a DB query.
        io.of('/candidate').in(`meeting:${meetingId}`).fetchSockets()
          .then((sockets) => { for (const cs of sockets) cs.data.meetingStatus = 'ended'; })
          .catch(() => {});

        ack({ ok: true });
        logger.info({ userId, meetingId, reason }, 'meeting ended by interviewer');
      } catch (err) {
        if (err instanceof NotFoundError) ack({ ok: false, error: 'Meeting not found', code: 'NOT_FOUND' });
        else if (err instanceof InvalidTransitionError) ack({ ok: false, error: 'Meeting cannot be ended in its current state', code: 'CONFLICT' });
        else {
          logger.error({ err, meetingId }, 'end_meeting failed');
          ack({ ok: false, error: 'Internal error', code: 'INTERNAL_ERROR' });
        }
      }
    });

    // ── Disconnect ────────────────────────────────────────────────────────

    socket.on('disconnect', (reason) => {
      const { meetingId } = socket.data;
      const intentional = reason === 'client namespace disconnect' || reason === 'server namespace disconnect';

      if (meetingId) {
        if (intentional) {
          logger.debug({ socketId: socket.id, userId, meetingId, reason }, 'interviewer intentional disconnect - skipping grace timer');
        } else {
          meetingService
            .onParticipantDisconnect(meetingId, userId)
            .then(() => broadcast.meetingStatus(meetingId, 'interrupted'))
            .catch((err) => logger.error({ err, meetingId, userId }, 'onParticipantDisconnect failed'));
        }
      }

      logger.info({ socketId: socket.id, userId, reason }, 'interviewer disconnected');
    });

    // ── Notes ─────────────────────────────────────────────────────────────

    onSafe(socket, {
      event: 'add_note',
      schema: addNoteSchema,
      rateLimit: { limit: 30, windowMs: 60_000 },
    }, async ({ meetingId, anchorSegmentId, body }, { ack }) => {
      try {
        const meeting = await meetingService.getMeeting(meetingId);
        if (meeting.interviewerId !== userId) {
          ack({ ok: false, error: 'Meeting not found', code: 'NOT_FOUND' });
          return;
        }
        const note = await transcriptService.addNote({
          meetingId,
          anchorSegmentId: anchorSegmentId ?? null,
          authorUserId: userId,
          body,
        });
        broadcast.noteAdded(meetingId, note);
        ack({ ok: true, data: { noteId: note.id } });
      } catch (err) {
        if (err instanceof NotFoundError) ack({ ok: false, error: 'Anchor segment not found', code: 'NOT_FOUND' });
        else {
          logger.error({ err, meetingId }, 'add_note failed');
          ack({ ok: false, error: 'Internal error', code: 'INTERNAL_ERROR' });
        }
      }
    });

    onSafe(socket, {
      event: 'update_note',
      schema: updateNoteSchema,
      rateLimit: { limit: 30, windowMs: 60_000 },
    }, async ({ meetingId, noteId, body }, { ack }) => {
      try {
        await transcriptService.updateNote(noteId, body, userId);
        const updatedAt = new Date();
        broadcast.noteUpdated(meetingId, { noteId, body, updatedAt });
        ack({ ok: true });
      } catch (err) {
        if (err instanceof NotFoundError) ack({ ok: false, error: 'Note not found', code: 'NOT_FOUND' });
        else if (err instanceof ForbiddenError) ack({ ok: false, error: 'Only the note author may edit this note', code: 'FORBIDDEN' });
        else {
          logger.error({ err, noteId }, 'update_note failed');
          ack({ ok: false, error: 'Internal error', code: 'INTERNAL_ERROR' });
        }
      }
    });

    onSafe(socket, {
      event: 'delete_note',
      schema: deleteNoteSchema,
      rateLimit: { limit: 30, windowMs: 60_000 },
    }, async ({ meetingId, noteId }, { ack }) => {
      try {
        await transcriptService.deleteNote(noteId, userId);
        broadcast.noteDeleted(meetingId, { noteId });
        ack({ ok: true });
      } catch (err) {
        if (err instanceof NotFoundError) ack({ ok: false, error: 'Note not found', code: 'NOT_FOUND' });
        else if (err instanceof ForbiddenError) ack({ ok: false, error: 'Only the note author may delete this note', code: 'FORBIDDEN' });
        else {
          logger.error({ err, noteId }, 'delete_note failed');
          ack({ ok: false, error: 'Internal error', code: 'INTERNAL_ERROR' });
        }
      }
    });

    // ── Video resume ──────────────────────────────────────────────────────

    onSafe(socket, {
      event: 'share_video',
      schema: shareVideoSchema,
      rateLimit: { limit: 10, windowMs: 60_000 },
    }, async ({ meetingId, videoId }) => {
      if (!socket.rooms.has(`meeting:${meetingId}`)) return;

      const result = await pool.query<{ storage_path: string }>(
        'SELECT storage_path FROM meeting_videos WHERE id = $1 AND meeting_id = $2',
        [videoId, meetingId],
      );
      if (result.rows.length === 0) {
        logger.warn({ userId, meetingId, videoId }, 'share_video: video not found');
        return;
      }

      const { data, error } = await supabaseAdmin.storage
        .from(VIDEO_BUCKET)
        .createSignedUrl(result.rows[0]!.storage_path, 3600);

      if (error || !data) {
        logger.error({ error, meetingId, videoId }, 'share_video: signed URL generation failed');
        return;
      }

      const payload = { videoId, signedUrl: data.signedUrl, sharedBy: userId };
      io.of('/interviewer').in(`meeting:${meetingId}`).emit('video_available', payload);
      io.of('/candidate').in(`meeting:${meetingId}`).emit('video_available', payload);
      io.of('/supervisor').in(`meeting:${meetingId}`).emit('video_available', payload);
      logger.info({ userId, meetingId, videoId }, 'share_video: broadcast sent');
    });

    onSafe(socket, {
      event: 'video_play',
      schema: videoSyncSchema,
      rateLimit: { limit: 60, windowMs: 60_000 },
    }, ({ meetingId, videoId, currentTime }) => {
      if (!socket.rooms.has(`meeting:${meetingId}`)) return;
      const syncPayload = { videoId, currentTime };
      nsp.in(`meeting:${meetingId}`).except(socket.id).emit('video_play_sync', syncPayload);
      io.of('/candidate').in(`meeting:${meetingId}`).emit('video_play_sync', syncPayload);
      io.of('/supervisor').in(`meeting:${meetingId}`).emit('video_play_sync', syncPayload);
    });

    onSafe(socket, {
      event: 'video_pause',
      schema: videoSyncSchema,
      rateLimit: { limit: 60, windowMs: 60_000 },
    }, ({ meetingId, videoId, currentTime }) => {
      if (!socket.rooms.has(`meeting:${meetingId}`)) return;
      const syncPayload = { videoId, currentTime };
      nsp.in(`meeting:${meetingId}`).except(socket.id).emit('video_pause_sync', syncPayload);
      io.of('/candidate').in(`meeting:${meetingId}`).emit('video_pause_sync', syncPayload);
      io.of('/supervisor').in(`meeting:${meetingId}`).emit('video_pause_sync', syncPayload);
    });

    onSafe(socket, {
      event: 'video_seek',
      schema: videoSyncSchema,
      rateLimit: { limit: 60, windowMs: 60_000 },
    }, ({ meetingId, videoId, currentTime }) => {
      if (!socket.rooms.has(`meeting:${meetingId}`)) return;
      const syncPayload = { videoId, currentTime };
      nsp.in(`meeting:${meetingId}`).except(socket.id).emit('video_seek_sync', syncPayload);
      io.of('/candidate').in(`meeting:${meetingId}`).emit('video_seek_sync', syncPayload);
      io.of('/supervisor').in(`meeting:${meetingId}`).emit('video_seek_sync', syncPayload);
    });

    onSafe(socket, {
      event: 'approve_video',
      schema: approveVideoSchema,
      rateLimit: { limit: 5, windowMs: 60_000 },
    }, async ({ meetingId, videoId }, { ack }) => {
      if (!socket.rooms.has(`meeting:${meetingId}`)) {
        ack({ ok: false, error: 'Not in meeting room', code: 'FORBIDDEN' });
        return;
      }
      try {
        const { approvedAt } = await meetingService.approveVideo(meetingId, videoId, userId);

        const { rows: userRows } = await pool.query<{ name: string }>(
          `SELECT name FROM users WHERE id = $1`,
          [userId],
        );
        const approvedByName = userRows[0]?.name ?? null;

        const meeting = await meetingService.getMeeting(meetingId);
        const payload = { candidateId: meeting.candidateId, videoId, approvedAt, approvedByName };
        io.of('/interviewer').in(`meeting:${meetingId}`).emit('video_approved', payload);
        io.of('/candidate').in(`meeting:${meetingId}`).emit('video_approved', payload);
        io.of('/supervisor').in(`meeting:${meetingId}`).emit('video_approved', payload);

        ack({ ok: true });
        logger.info({ userId, meetingId, videoId }, 'approve_video: video approved');
      } catch (err) {
        if (err instanceof ConflictError) ack({ ok: false, error: err.message, code: 'ALREADY_APPROVED' });
        else if (err instanceof ForbiddenError) ack({ ok: false, error: err.message, code: 'FORBIDDEN' });
        else if (err instanceof NotFoundError) ack({ ok: false, error: err.message, code: 'NOT_FOUND' });
        else if (err instanceof InvalidTransitionError) ack({ ok: false, error: 'Cannot approve in current meeting state', code: 'CONFLICT' });
        else {
          logger.error({ err, meetingId, videoId }, 'approve_video failed');
          ack({ ok: false, error: 'Internal error', code: 'INTERNAL_ERROR' });
        }
      }
    });

    // Reconnect path: attach to an interrupted meeting if one exists.
    // All listeners are registered above so no events are dropped during this await.
    const currentMeeting = await meetingService.resumeOrAttachCurrentMeeting(userId, 'interviewer');
    if (currentMeeting) {
      try {
        let status = currentMeeting.status;
        if (currentMeeting.shouldMarkReconnected) {
          await meetingService.onParticipantReconnect(currentMeeting.id, userId);
          status = 'active';
          broadcast.meetingStatus(currentMeeting.id, status);
        }

        socket.data.meetingId = currentMeeting.id;
        await socket.join(`meeting:${currentMeeting.id}`);

        const uid = AgoraTokenService.deriveUid(currentMeeting.id, userId);
        const agoraToken = agoraTokenService.generateToken({
          channelName: currentMeeting.agoraChannel,
          uid,
          role: 'publisher',
        });

        const activeVideo = await meetingService.getActiveVideoForCandidate(currentMeeting.candidateId)
          .catch((err) => { logger.error({ err, meetingId: currentMeeting.id }, 'getActiveVideoForCandidate failed'); return null; });

        socket.emit('meeting_attached', {
          meetingId:     currentMeeting.id,
          status,
          agoraChannel:  currentMeeting.agoraChannel,
          agoraToken,
          uid,
          candidateId:   currentMeeting.candidateId,
          interviewerId: currentMeeting.interviewerId,
          participantUids: {
            interviewerUid: currentMeeting.interviewerId
              ? AgoraTokenService.deriveUid(currentMeeting.id, currentMeeting.interviewerId)
              : null,
            candidateUid: AgoraTokenService.deriveUid(currentMeeting.id, currentMeeting.candidateId),
          },
          activeVideo,
        });

        logger.info(
          { socketId: socket.id, userId, meetingId: currentMeeting.id, status },
          'interviewer reattached to current meeting',
        );
      } catch (err) {
        logger.warn({ err, userId, meetingId: currentMeeting.id }, 'interviewer meeting reattach failed');
      }
    }

    logger.info({ socketId: socket.id, userId, role }, 'interviewer connected');
  });
}
