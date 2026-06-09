import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type http from 'http';
import type { MeetingService } from '../domain/MeetingService.js';
import type { PresenceService } from '../domain/PresenceService.js';
import type { AgoraTokenService } from '../domain/AgoraTokenService.js';
import type { TranscriptService } from '../domain/TranscriptService.js';
import type { SessionService } from '../domain/SessionService.js';
import type { DeepgramManager } from '../lib/DeepgramManager.js';
import { env } from '../config/env.js';
import { redis } from '../db/redis.js';
import { BroadcastHelper } from './broadcast.js';
import { registerInterviewerNamespace } from './namespaces/interviewer.js';
import { registerCandidateNamespace } from './namespaces/candidate.js';
import { registerSupervisorNamespace } from './namespaces/supervisor.js';
import { logger } from '../lib/logger.js';

export interface SocketServerDeps {
  meetingService: MeetingService;
  presenceService: PresenceService;
  agoraTokenService: AgoraTokenService;
  transcriptService: TranscriptService;
  sessionService: SessionService;
  deepgramManager: DeepgramManager;
}

export function createSocketServer(
  httpServer: http.Server,
  deps: SocketServerDeps,
  options: { redisAvailable?: boolean } = {},
): { broadcast: BroadcastHelper; io: Server } {
  const origins = env.CLIENT_ORIGIN.split(',').map((s) => s.trim());

  const io = new Server(httpServer, {
    cors: { origin: origins, credentials: true },
  });

  if (options.redisAvailable && redis) {
    const pubClient = redis.duplicate();
    const subClient = redis.duplicate();
    io.adapter(createAdapter(pubClient, subClient));
    logger.info('Socket.IO Redis adapter attached');
  } else {
    logger.info('Socket.IO using in-memory adapter (Redis not available)');
  }

  const broadcast = new BroadcastHelper(io, deps.meetingService);

  registerInterviewerNamespace(io, {
    meetingService:    deps.meetingService,
    presenceService:   deps.presenceService,
    agoraTokenService: deps.agoraTokenService,
    transcriptService: deps.transcriptService,
    sessionService:    deps.sessionService,
    broadcast,
    io,
  });

  registerCandidateNamespace(io, {
    io,
    presenceService:   deps.presenceService,
    meetingService:    deps.meetingService,
    agoraTokenService: deps.agoraTokenService,
    sessionService:    deps.sessionService,
    transcriptService: deps.transcriptService,
    deepgramManager:   deps.deepgramManager,
    broadcast,
  });

  registerSupervisorNamespace(io, {
    meetingService:    deps.meetingService,
    transcriptService: deps.transcriptService,
    agoraTokenService: deps.agoraTokenService,
    sessionService:    deps.sessionService,
  });

  logger.info({ origins }, 'socket server attached');

  return { broadcast, io };
}
