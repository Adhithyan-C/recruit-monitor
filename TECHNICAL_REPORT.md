# RecruitMonitor — Technical Report

> Generated 2026-06-10 for onboarding a fresh Claude conversation with full codebase context.

---

## 1. Project Overview

RecruitMonitor is a real-time technical interview monitoring platform. Candidates join a waiting room and create a solo video room; interviewers browse a live list of open rooms and join one-at-a-time; supervisors silently monitor any active interview without publishing audio or video (stealth mode).

**Core value proposition:** Candidate audio is server-side transcribed by Deepgram Nova-2 the moment the room opens, so the full transcript (with timestamps and confidence scores) is available to both parties in real time. Interviewers can anchor timestamped notes to any transcript segment.

**Three roles:**
- **Candidate** — connects to `/candidate` namespace, calls `start_session` to create an open room, sends raw PCM audio via `audio_chunk`, receives live transcript via `transcript_segment`.
- **Interviewer** — connects to `/interviewer` namespace, sees language-filtered list of open rooms, calls `join_open_meeting` to activate a room, can end the meeting and write notes.
- **Supervisor** — connects to `/supervisor` namespace as subscriber-only (no mic/cam), monitors active/interrupted meetings and gets transcript + notes feed.

**Deployment targets:**
- Server → Railway (Docker, `node:22-alpine`, healthcheck at `/health`)
- Client → Vercel (Vite SPA, `client/vercel.json` has SPA rewrite rule)

---

## 2. Complete File Tree

### Root
```
interview-platform/
├── CLAUDE.md                    Project instructions for Claude Code
├── CLAUDE.local.md              Private per-user Claude preferences
├── TECHNICAL_REPORT.md          This file
├── server/
│   ├── Dockerfile               Production Docker image (node:22-alpine)
│   ├── railway.json             Railway deploy config (healthcheck, restart policy)
│   ├── package.json             Server deps and scripts
│   ├── migrations/              SQL migrations run manually (0001–0004)
│   │   ├── 0001_init.sql        Initial schema: all tables, enums, indexes
│   │   ├── 0002_open_meetings.sql   Adds 'open' to meeting_status enum
│   │   ├── 0003_open_meetings_schema.sql   Makes interviewer_id nullable; updates unique index
│   │   └── 0004_meeting_videos.sql   meeting_videos table + Supabase Storage notes
│   └── src/
│       ├── server.ts            Entry point — Express app, boot sequence, graceful shutdown
│       ├── config/
│       │   └── env.ts           Zod-validated env schema; process.exit(1) on invalid vars
│       ├── auth/
│       │   ├── jwt.ts           issueInternalJwt / verifyInternalJwt / decodeExpiredJwt
│       │   └── supabase.ts      verifySupabaseToken — calls Supabase admin.auth.getUser
│       ├── lib/
│       │   ├── logger.ts        Pino logger instance
│       │   ├── logger.js        [LEGACY JS] Old logger shim (superseded by .ts)
│       │   ├── errors.ts        DomainError, NotFoundError, AuthError, ForbiddenError, etc.
│       │   ├── ids.ts           newId() — nanoid-based UUID-like ID generator
│       │   ├── supabase.ts      supabaseAdmin client (service role key)
│       │   ├── supabase.js      [LEGACY JS] Old supabase client shim
│       │   └── DeepgramManager.ts   Deepgram live transcription sessions with backoff
│       ├── db/
│       │   ├── pool.ts          pg.Pool singleton; checkDbConnection()
│       │   ├── redis.ts         ioredis singleton; waitForRedis(); optional
│       │   └── migrate.ts       Migration runner (tsx src/db/migrate.ts)
│       ├── domain/
│       │   ├── meetingMachine.ts    Transition tables + guard functions (pure state machine)
│       │   ├── MeetingService.ts    Meeting CRUD, lifecycle transitions, Deepgram integration
│       │   ├── TranscriptService.ts Segment/note write buffer + read queries
│       │   ├── PresenceService.ts   Candidate presence (waiting/offline) + broadcast
│       │   ├── ClaimService.ts      Legacy claim flow (waiting → claimed → connecting)
│       │   ├── AgoraTokenService.ts RTC token generation + deterministic UID derivation
│       │   └── SessionService.ts    One-shot reconnect tokens (issue/consume)
│       ├── http/
│       │   ├── auth.ts          POST /auth/session, POST /auth/refresh, GET /auth/me
│       │   ├── meetings.ts      GET /meetings/:id, /transcript, /notes
│       │   ├── videos.ts        POST /meetings/:id/videos/upload-url, /videos, GET /stream-url
│       │   ├── candidates.ts    GET /candidates/:id/history, /history/:mid/transcript, /notes
│       │   ├── metrics.ts       GET /metrics (supervisor/admin only)
│       │   └── middleware/
│       │       └── requireAuth.ts   HTTP middleware: verifies internal JWT, attaches req.user
│       ├── socket/
│       │   ├── io.ts            createSocketServer(); attaches Redis adapter if available
│       │   ├── broadcast.ts     BroadcastHelper — centralises all server→client emits
│       │   ├── rateLimiter.ts   In-process token-bucket per (namespace, event, userId)
│       │   ├── safeHandler.ts   onSafe() — wraps handlers with Zod validation + rate limit
│       │   ├── types.ts         CandidateSocket, InterviewerSocket, SupervisorSocket types
│       │   ├── namespaces/
│       │   │   ├── candidate.ts     /candidate namespace: start_session, audio_chunk, notes, video
│       │   │   ├── interviewer.ts   /interviewer namespace: open rooms, join, end, notes, video
│       │   │   └── supervisor.ts    /supervisor namespace: subscribe, join_room (subscriber)
│       │   ├── middleware/
│       │   │   ├── requireJwtSocket.ts      Verifies internal JWT; rejects if expired/wrong role
│       │   │   └── attachReconnectSession.ts  Looks up reconnect_token; attaches session to socket.data
│       │   └── schemas/
│       │       ├── candidate.ts     Zod schemas for candidate events
│       │       ├── interviewer.ts   Zod schemas for interviewer events
│       │       ├── supervisor.ts    Zod schemas for supervisor events
│       │       └── video.ts         Zod schemas for video sync events
│       ├── migrations/
│       │   └── 0005_language.sql    Adds language column to users (english/tamil/hindi)
│       ├── policy/
│       │   ├── canViewMeeting.ts    Auth policy: can this user read meeting data?
│       │   └── canViewCandidateHistory.ts  Auth policy: can this user read candidate history?
│       ├── scheduler/
│       │   ├── bullScheduler.ts     BullScheduler (Redis/BullMQ) + MemoryScheduler fallback
│       │   ├── recovery.ts          Boot-time cleanup: deletes expired sessions
│       │   └── sweeper.ts           Interval: marks stale heartbeats offline, purges sessions
│       └── types/
│           ├── express.d.ts         Augments Express Request with req.user
│           └── agora-token.d.ts     Type shim for CJS agora-token package
```

### Client
```
client/
├── vercel.json                  SPA rewrite: all paths → /index.html
├── vite.config.js               Vite config with /api proxy to localhost:4000
├── package.json                 Client deps and scripts
└── src/
    ├── main.jsx                 React 19 root mount — NO StrictMode (deliberate)
    ├── App.jsx                  BrowserRouter, routes, ProtectedRoute, RoomGuard, AppInit
    ├── index.css                Tailwind base styles + custom CSS variables
    ├── config.js                VITE_API_URL, VITE_SOCKET_URL, VITE_AGORA_APP_ID
    ├── lib/
    │   └── supabase.js          Supabase browser client (anon key)
    ├── store/
    │   ├── useAuthStore.js      Zustand: user, token, login/logout, rehydrate, tryRefresh
    │   ├── useMeetingStore.js   Zustand: meetingId, channels, UIDs, status, participant names
    │   ├── useTranscriptStore.js  Zustand: segments[], notes[], interimSegment, failed flag
    │   └── useRoomStore.js      Zustand: roomId for RoomGuard (legacy, minimal)
    ├── hooks/
    │   ├── useSocket.js         Module-level singletons; getSocket(role), reconnect token mgmt
    │   ├── useAgora.js          Agora RTC lifecycle: joinChannel, leaveChannel, mute, camera
    │   ├── useTranscript.js     Audio worklet pipeline → audio_chunk emits + heartbeat
    │   └── useVideoResume.js    Video file upload flow to Supabase Storage via signed URL
    ├── utils/
    │   ├── tokenStorage.js      localStorage wrapper for the internal JWT
    │   └── mediaLogger.js       Filtered console logger for media events
    ├── pages/
    │   ├── LoginPage.jsx        Supabase email/password login → POST /auth/session
    │   ├── RegisterPage.jsx     Supabase sign-up with role + language metadata
    │   ├── CandidateWaitingRoom.jsx  Camera preview + "Start Session" → start_session emit
    │   ├── CandidateJoinPage.jsx    Legacy join-by-room-code page (currently unused route)
    │   ├── InterviewerDashboard.jsx  Open rooms list; subscribe_open_rooms; join_open_meeting
    │   ├── SupervisorDashboard.jsx   Active meetings grid; subscribe_active_meetings; join_room
    │   └── InterviewRoom.jsx    Main room: video grid + transcript/notes/video/history tabs
    └── components/
        ├── VideoGrid.jsx        Agora video tiles (local + remote)
        ├── TranscriptBox.jsx    Scrolling transcript with segment renderer + add-note button
        ├── NotesPanel.jsx       Notes list with add/edit/delete (interviewer only)
        ├── HistoryPanel.jsx     Past interview history for a candidate (fetches HTTP)
        ├── CandidateHistoryModal.jsx  Modal wrapper for HistoryPanel on interviewer dashboard
        ├── VideoResumePanel.jsx Video upload + shared video player with sync controls
        ├── RoomControls.jsx     Desktop bottom bar: mute, camera, end call
        ├── ParticipantPanel.jsx Desktop participant names + role badges
        ├── ActiveRoomCard.jsx   Individual room card for supervisor (legacy/unused)
        └── ErrorBoundary.jsx    React error boundary wrapping InterviewRoom
```

---

## 3. Tech Stack

### Server (`server/package.json`)

| Dependency | Version | Role |
|---|---|---|
| `express` | ^4.19.0 | HTTP server framework |
| `socket.io` | ^4.7.0 | WebSocket server (3 namespaces) |
| `@socket.io/redis-adapter` | ^8.3.0 | Multi-node socket fan-out via Redis |
| `@deepgram/sdk` | ^3.5.0 | Deepgram Nova-2 live transcription |
| `@supabase/supabase-js` | ^2.45.0 | Supabase admin client (auth + storage) |
| `agora-token` | ^2.0.4 | Server-side Agora RTC token generation |
| `bullmq` | ^5.78.0 | Redis-backed delayed job queue (grace/claim timers) |
| `ioredis` | ^5.11.0 | Redis client (adapter + BullMQ + manual cache) |
| `pg` | ^8.12.0 | PostgreSQL driver (direct connection, non-pooled) |
| `jsonwebtoken` | ^9.0.0 | Internal JWT issue + verify |
| `zod` | ^3.23.0 | Schema validation (env, socket events) |
| `pino` | ^9.3.0 | Structured JSON logger |
| `pino-http` | ^10.0.0 | HTTP request logging middleware |
| `helmet` | ^7.1.0 | Security headers |
| `cors` | ^2.8.6 | CORS middleware |
| `express-rate-limit` | ^7.4.0 | HTTP rate limiting on /auth routes |
| `dotenv` | ^16.4.7 | .env file loading |
| `uuid` | ^10.0.0 | UUID generation |
| `ws` | ^8.18.0 | WebSocket dependency for Deepgram SDK |
| `tsx` | ^4.16.0 | TypeScript execution (dev + production start) |
| `typescript` | ^5.5.0 | Type checking |
| `vitest` | ^2.0.0 | Test runner |

### Client (`client/package.json`)

| Dependency | Version | Role |
|---|---|---|
| `react` | ^19.2.6 | UI framework |
| `react-dom` | ^19.2.6 | DOM renderer |
| `react-router-dom` | ^7.15.1 | SPA routing |
| `socket.io-client` | ^4.8.3 | Socket.IO client (3 namespace singletons) |
| `agora-rtc-sdk-ng` | ^4.24.3 | Agora RTC SDK for video/audio |
| `@supabase/supabase-js` | ^2.106.1 | Supabase browser client (auth only) |
| `zustand` | ^5.0.13 | Lightweight global state (3 stores) |
| `axios` | ^1.16.1 | HTTP client (used in some fetch calls) |
| `tailwindcss` | ^3.4.19 | Utility CSS |
| `@fontsource/geist` | ^5.2.9 | Geist font |
| `vite` | ^8.0.12 | Build tool + dev server |
| `@vitejs/plugin-react` | ^6.0.1 | React fast-refresh |

---

## 4. Database Schema

All migrations must be run in order against the Supabase PostgreSQL database.

### Enums

```sql
CREATE TYPE user_role         AS ENUM ('candidate', 'interviewer', 'supervisor');
CREATE TYPE candidate_status  AS ENUM ('offline', 'waiting', 'claimed', 'in_meeting', 'disconnected');
CREATE TYPE meeting_status    AS ENUM ('open', 'waiting', 'claimed', 'connecting', 'active', 'interrupted', 'ended', 'cancelled');
CREATE TYPE end_reason        AS ENUM ('interviewer_ended', 'candidate_left', 'grace_expired', 'claim_expired', 'admin_terminated', 'error');
CREATE TYPE participant_role  AS ENUM ('candidate', 'interviewer', 'supervisor');
CREATE TYPE speaker_role      AS ENUM ('candidate', 'interviewer', 'system');
```

### Table: `users`
| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK — set from Supabase auth.users.id |
| `email` | TEXT | NOT NULL, UNIQUE |
| `role` | user_role | NOT NULL |
| `name` | TEXT | NOT NULL |
| `org_id` | UUID | nullable |
| `language` | TEXT | NOT NULL DEFAULT 'english' CHECK (IN 'english','tamil','hindi') — added by migration 0005 |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |

### Table: `meetings`
| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK DEFAULT gen_random_uuid() |
| `candidate_id` | UUID | NOT NULL FK→users(id) |
| `interviewer_id` | UUID | nullable FK→users(id) — nullable since migration 0003 |
| `status` | meeting_status | NOT NULL DEFAULT 'waiting' |
| `agora_channel` | TEXT | NOT NULL, UNIQUE |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| `started_at` | TIMESTAMPTZ | nullable — set when status→active |
| `ended_at` | TIMESTAMPTZ | nullable — set when status→ended |
| `end_reason` | end_reason | nullable |

### Table: `candidate_presence`
| Column | Type | Constraints |
|---|---|---|
| `user_id` | UUID | PK FK→users(id) ON DELETE CASCADE |
| `status` | candidate_status | NOT NULL DEFAULT 'offline' |
| `socket_id` | TEXT | nullable |
| `last_heartbeat_at` | TIMESTAMPTZ | nullable |
| `claimed_by` | UUID | nullable FK→users(id) |
| `claimed_at` | TIMESTAMPTZ | nullable |
| `current_meeting_id` | UUID | nullable FK→meetings(id) |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |

### Table: `meeting_participants`
| Column | Type | Constraints |
|---|---|---|
| `meeting_id` | UUID | PK part, FK→meetings(id) ON DELETE CASCADE |
| `user_id` | UUID | PK part, FK→users(id) |
| `role` | participant_role | NOT NULL |
| `agora_uid` | INTEGER | NOT NULL |
| `joined_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| `left_at` | TIMESTAMPTZ | nullable |
| `disconnected_at` | TIMESTAMPTZ | nullable |

### Table: `sessions`
| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK DEFAULT gen_random_uuid() |
| `user_id` | UUID | NOT NULL FK→users(id) ON DELETE CASCADE |
| `reconnect_token` | TEXT | NOT NULL, UNIQUE |
| `expires_at` | TIMESTAMPTZ | NOT NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |

### Table: `transcript_segments`
| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK DEFAULT gen_random_uuid() |
| `meeting_id` | UUID | NOT NULL FK→meetings(id) ON DELETE CASCADE |
| `seq` | INTEGER | NOT NULL — UNIQUE (meeting_id, seq) |
| `speaker_user_id` | UUID | nullable FK→users(id) — null for system segments |
| `speaker_role` | speaker_role | NOT NULL |
| `text` | TEXT | NOT NULL |
| `started_at` | TIMESTAMPTZ | NOT NULL |
| `ended_at` | TIMESTAMPTZ | NOT NULL |
| `is_final` | BOOLEAN | NOT NULL DEFAULT false |
| `confidence` | FLOAT | nullable |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |

### Table: `transcript_notes`
| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK DEFAULT gen_random_uuid() |
| `meeting_id` | UUID | NOT NULL FK→meetings(id) ON DELETE CASCADE |
| `anchor_segment_id` | UUID | nullable FK→transcript_segments(id) |
| `author_user_id` | UUID | NOT NULL FK→users(id) |
| `body` | TEXT | NOT NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |

### Table: `meeting_videos`
| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK DEFAULT gen_random_uuid() |
| `meeting_id` | UUID | NOT NULL FK→meetings(id) ON DELETE CASCADE |
| `candidate_id` | UUID | NOT NULL FK→users(id) |
| `interviewer_id` | UUID | nullable FK→users(id) |
| `candidate_name` | TEXT | NOT NULL |
| `interviewer_name` | TEXT | nullable |
| `storage_path` | TEXT | NOT NULL — path inside Supabase Storage bucket `interview-videos` |
| `type` | TEXT | NOT NULL CHECK (IN 'candidate_upload','interviewer_recording') |
| `meeting_date` | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |

### Indexes
| Name | Table | Columns | Type |
|---|---|---|---|
| `one_active_meeting_per_candidate` | meetings | candidate_id WHERE status IN ('open','claimed','connecting','active','interrupted') | UNIQUE PARTIAL |
| `idx_meetings_status_candidate` | meetings | (status, candidate_id) | btree |
| `idx_meetings_interviewer_status` | meetings | (interviewer_id, status) | btree |
| `idx_transcript_segments_meeting_seq` | transcript_segments | (meeting_id, seq) | btree |
| `idx_candidate_presence_status_heartbeat` | candidate_presence | (status, last_heartbeat_at) | btree |
| `idx_sessions_expires_at` | sessions | expires_at | btree |
| `idx_sessions_user_id` | sessions | user_id | btree |
| `meeting_videos_meeting_id` | meeting_videos | meeting_id | btree |

### Migrations Chronology
1. **0001_init.sql** — All enums, all tables, all indexes (baseline schema)
2. **0002_open_meetings.sql** — `ALTER TYPE meeting_status ADD VALUE 'open'` (separate transaction required)
3. **0003_open_meetings_schema.sql** — Drop NOT NULL on `meetings.interviewer_id`; update partial unique index to include 'open'
4. **0004_meeting_videos.sql** — `meeting_videos` table; Supabase Storage bucket setup instructions
5. **0005_language.sql** (in `server/src/migrations/`) — `ALTER TABLE users ADD COLUMN language TEXT`

---

## 5. Environment Variables

### Server (server/.env)

| Variable | Required | Default | Source | Purpose |
|---|---|---|---|---|
| `DATABASE_URL` | Yes | — | Supabase | Direct (non-pooled) PostgreSQL connection string |
| `JWT_SECRET` | Yes (≥32 chars) | — | Manual | Signing key for internal JWTs |
| `JWT_EXPIRES_IN` | No | `15m` | — | Internal JWT TTL (passed to jsonwebtoken) |
| `SUPABASE_URL` | Yes | — | Supabase | Project URL for supabaseAdmin client |
| `SUPABASE_ANON_KEY` | Yes | — | Supabase | Anon key for supabaseAdmin |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | — | Supabase | Service role key for admin operations + storage |
| `AGORA_APP_ID` | Yes | — | Agora Console | Agora App ID |
| `AGORA_APP_CERTIFICATE` | Yes | — | Agora Console | App certificate for server-side token generation |
| `AGORA_TOKEN_TTL_SECONDS` | No | `3600` | — | Agora RTC token validity window |
| `DEEPGRAM_API_KEY` | Yes | — | Deepgram | API key for Nova-2 live transcription |
| `CLIENT_ORIGIN` | Yes | — | Manual | Comma-separated allowed CORS origins |
| `REDIS_URL` | No | — | Upstash/Redis | Redis URL; if absent, falls back to MemoryScheduler |
| `GRACE_WINDOW_SECONDS` | No | `30` | — | Seconds before an interrupted meeting auto-ends |
| `CLAIM_TTL_SECONDS` | No | `60` | — | Seconds before an unclaimed meeting reverts to waiting |
| `PRESENCE_HEARTBEAT_INTERVAL_SECONDS` | No | `10` | — | How often candidate emits heartbeat (client reads this indirectly) |
| `PRESENCE_STALE_AFTER_SECONDS` | No | `30` | — | Heartbeat age threshold for sweeper eviction |
| `PRESENCE_SWEEPER_INTERVAL_SECONDS` | No | `15` | — | How often the sweeper tick runs |
| `SESSION_TTL_SECONDS` | No | `60` | — | Reconnect token TTL in sessions table |
| `PORT` | No | `4000` | Railway auto-sets | HTTP listen port |
| `NODE_ENV` | No | `development` | — | Controls log format and error detail |
| `LOG_LEVEL` | No | `info` | — | Pino log level |

### Client (client/.env)

| Variable | Required | Purpose |
|---|---|---|
| `VITE_API_URL` | Yes | Base URL for HTTP requests (e.g. `http://localhost:4000`) |
| `VITE_SOCKET_URL` | Yes | Base URL for Socket.IO connections |
| `VITE_AGORA_APP_ID` | Yes | Agora App ID for client-side RTC SDK |

---

## 6. Complete API Reference

All HTTP endpoints are on the server (default port 4000). Internal JWT is passed as `Authorization: Bearer <token>`.

### Auth

#### `POST /auth/session`
Exchange a Supabase JWT for an internal JWT.
- **Auth:** None (Supabase JWT in Authorization header)
- **Rate limit:** 20 req/min
- **Request:** `Authorization: Bearer <supabase_access_token>`
- **Response:** `{ token: string, user: { id, email, name, role, language } }`
- **Side effect:** Upserts user into `users` table with email/name from Supabase metadata; role and language are read from `user_metadata`

#### `POST /auth/refresh`
Reissue an expired internal JWT within the 1-hour grace window.
- **Auth:** Expired internal JWT in Authorization header
- **Rate limit:** 20 req/min
- **Request:** `Authorization: Bearer <expired_internal_jwt>`
- **Response:** `{ token: string }`
- **Errors:** 401 if token is malformed or grace window has passed

#### `GET /auth/me`
Return current user from the internal JWT.
- **Auth:** Valid internal JWT required
- **Response:** `{ user: { userId, email, role, orgId, language } }`

### Meetings

#### `GET /meetings/:meetingId`
Get meeting details with participant names.
- **Auth:** Internal JWT required; policy: candidate must own the meeting, interviewer must be assigned, supervisor has access
- **Response:** `{ meeting: { id, interviewerId, candidateId, agoraChannel, status, interviewerName, candidateName, interviewerAgoraUid, candidateAgoraUid } }`
- **Errors:** 403 FORBIDDEN, 404 NOT_FOUND

#### `GET /meetings/:meetingId/transcript?afterSeq=0&limit=100`
Paginated transcript segments (cursor-based by seq).
- **Auth:** Internal JWT; same policy as above
- **Query:** `afterSeq` (exclusive lower bound, default 0), `limit` (1–500, default 100)
- **Response:** `{ segments: SegmentRow[] }`

#### `GET /meetings/:meetingId/notes?updatedAfter=<iso>`
All notes for a meeting, optionally filtered by update time.
- **Auth:** Internal JWT; same policy
- **Response:** `{ notes: NoteRow[] }`

#### `POST /meetings/:meetingId/videos/upload-url`
Get a Supabase Storage signed upload URL.
- **Auth:** Internal JWT; must be a participant
- **Request body:** `{ filename: string, contentType: "video/mp4"|"video/webm"|"video/quicktime" }`
- **Response:** `{ uploadUrl: string, storagePath: string }`
- **Errors:** 400 VALIDATION_ERROR, 403 FORBIDDEN, 404 NOT_FOUND

#### `POST /meetings/:meetingId/videos`
Register a video after upload completes.
- **Auth:** Internal JWT; must be a participant
- **Request body:** `{ storagePath, type: "candidate_upload"|"interviewer_recording", candidateName, interviewerName? }`
- **Response:** `{ videoId: string }`

#### `GET /meetings/:meetingId/videos/:videoId/stream-url`
Get a 1-hour signed playback URL.
- **Auth:** Internal JWT; must be a participant
- **Response:** `{ signedUrl: string }`

### Candidates

#### `GET /candidates/:candidateId/history`
Index of all ended meetings for a candidate.
- **Auth:** Internal JWT; candidate sees own history, interviewer/supervisor sees all
- **Response:** `{ history: [{ meetingId, interviewerName, startedAt, endedAt, durationMinutes, segmentCount, noteCount }] }`

#### `GET /candidates/:candidateId/history/:meetingId/transcript`
All segments for one ended meeting (up to 5000).
- **Auth:** Same policy
- **Response:** `{ segments: SegmentRow[] }`

#### `GET /candidates/:candidateId/history/:meetingId/notes`
All notes for one ended meeting.
- **Auth:** Same policy
- **Response:** `{ notes: NoteRow[] }`

### Other

#### `GET /health`
Health probe (no auth). Suppressed from access logs.
- **Response:** `{ status: "ok", version, nodeEnv, uptime }`

#### `GET /metrics`
Runtime metrics (supervisor/admin only).
- **Auth:** Internal JWT, role must be `supervisor` or `admin`
- **Response:** `{ activeMeetings, queueDepth, scheduledJobs, deepgramSessions }`

---

## 7. Socket Architecture

All namespaces share the same Socket.IO server instance. Redis adapter is attached when `REDIS_URL` is set, enabling multi-process fan-out.

### Middleware chain (all namespaces)

1. **`requireJwtSocket`** — reads `handshake.auth.token`, calls `verifyInternalJwt()`, attaches to `socket.data.user`. Rejects with `AUTH_ERROR: *` if missing/expired/wrong role.
2. **`attachReconnectSession`** — reads `handshake.auth.reconnect_token`, calls `SessionService.findByToken()` (DELETE...RETURNING), attaches `SessionRecord` to `socket.data.session` if found. Never rejects.

### `socket.data` shape

```typescript
// Candidate and Interviewer
socket.data = {
  user: { userId, email, role, orgId, language, exp, iat },
  session?: SessionRecord,  // consumed if reconnect token was valid
  meetingId?: string,       // set after start_session or join
  meetingStatus?: MeetingStatus, // candidate only — drives audio_chunk gate
}
```

---

### Namespace: `/candidate`

**Auth:** Internal JWT required. Role must be `candidate`.

**Rooms joined on connect:**
- `user:<userId>` — used to detect and evict duplicate tabs

**Events client → server:**

| Event | Rate Limit | Payload | Description |
|---|---|---|---|
| `start_session` | 20/min | `{}` | Creates an open meeting; triggers Deepgram start; emits `meeting_attached` |
| `heartbeat` | 1 per 8s | `{}` | No-op (presence managed by meeting status now) |
| `audio_chunk` | 200KB/s | `Buffer` (PCM 16kHz mono, 2–32768 bytes, even length) | Forwarded to Deepgram |
| `add_note` | 30/min | `{ meetingId, anchorSegmentId?, body }` | Creates note; broadcasts `note_added` |
| `update_note` | 30/min | `{ meetingId, noteId, body }` | Updates note body (author only) |
| `delete_note` | 30/min | `{ meetingId, noteId }` | Deletes note (author only) |
| `share_video` | 10/min | `{ meetingId, videoId }` | Generates signed URL; broadcasts `video_available` to all 3 namespaces |
| `video_play` | 60/min | `{ meetingId, videoId, currentTime }` | Broadcasts `video_play_sync` to all others in meeting |
| `video_pause` | 60/min | `{ meetingId, videoId, currentTime }` | Broadcasts `video_pause_sync` |
| `video_seek` | 60/min | `{ meetingId, videoId, currentTime }` | Broadcasts `video_seek_sync` |

**Events server → client:**

| Event | Trigger | Payload |
|---|---|---|
| `session_established` | On connect | `{ reconnectToken, expiresAt }` |
| `session_replaced` | Another tab connected with same identity | `{}` |
| `meeting_attached` | start_session ack OR reconnect path | `{ meetingId, status, agoraChannel, agoraToken, uid, candidateId, interviewerId, participantUids }` |
| `meeting_status` | Any status transition | `{ meetingId, status, interviewerName?, participantUids? }` |
| `transcript_segment` | Deepgram final result | `SegmentRow` |
| `transcript_error` | Deepgram fatal error | `{ meetingId }` |
| `note_added` | Any participant adds note | `NoteRow` |
| `note_updated` | Author edits note | `{ noteId, body, updatedAt }` |
| `note_deleted` | Author deletes note | `{ noteId }` |
| `video_available` | Someone shares a video | `{ videoId, signedUrl, sharedBy }` |
| `video_play_sync` | Remote participant plays | `{ videoId, currentTime }` |
| `video_pause_sync` | Remote participant pauses | `{ videoId, currentTime }` |
| `video_seek_sync` | Remote participant seeks | `{ videoId, currentTime }` |

**Disconnect behaviour:**
- If `meetingId` is set and status is `open` → `endMeeting('candidate_left')`, broadcast `ended`, trigger `openRoomsUpdate`
- If `meetingId` is set, status is not `open`, and disconnect was unintentional → `onParticipantDisconnect`, broadcast `interrupted`, start grace timer
- Intentional disconnect (client namespace disconnect) → no grace timer

---

### Namespace: `/interviewer`

**Auth:** Internal JWT required. Role must be `interviewer`.

**Rooms joined on connect:**
- `user:<userId>` — used to detect and evict duplicate tabs

**Events client → server:**

| Event | Rate Limit | Payload | Description |
|---|---|---|---|
| `subscribe_open_rooms` | 20/min | `{}` | Joins `open_rooms_monitor` room; returns language-filtered open rooms |
| `join_open_meeting` | 10/min | `{ meetingId }` | Activates an open room (open→active); emits `meeting_attached` to self |
| `join_room` | 20/min | `{ meetingId }` | Legacy reconnect path for active/interrupted meeting |
| `end_meeting` | 10/min | `{ meetingId, reason }` | Ends meeting; broadcasts `ended` status |
| `add_note` | 30/min | `{ meetingId, anchorSegmentId?, body }` | Same as candidate |
| `update_note` | 30/min | `{ meetingId, noteId, body }` | Same as candidate |
| `delete_note` | 30/min | `{ meetingId, noteId }` | Same as candidate |
| `share_video` | 10/min | `{ meetingId, videoId }` | Same as candidate |
| `video_play/pause/seek` | 60/min each | `{ meetingId, videoId, currentTime }` | Same as candidate |

**Events server → client:** Same set as candidate, plus:

| Event | Trigger | Payload |
|---|---|---|
| `open_rooms_update` | `openRoomsUpdate()` fires after any room state change | `{ meetings: OpenMeetingDetails[] }` |
| `candidate_queue_update` | Legacy presence broadcast | `{ candidates: QueuedCandidate[] }` |

**Reconnect path:** On connection, `resumeOrAttachCurrentMeeting` looks for a meeting in statuses `open|claimed|connecting|active|interrupted`. If found and `interrupted`, calls `onParticipantReconnect` and broadcasts `active`.

---

### Namespace: `/supervisor`

**Auth:** Internal JWT required. Role must be `supervisor`.

**No room join on connect** (supervisors don't get a `user:` room — no eviction).

**Events client → server:**

| Event | Rate Limit | Payload | Description |
|---|---|---|---|
| `subscribe_active_meetings` | 20/min | `undefined` | Joins `meetings_monitor`; returns language-filtered active/interrupted meetings (Redis-cached, 5s TTL) |
| `join_room` | 30/min | `{ meetingId }` | Joins meeting as subscriber; returns agoraToken (subscriber role), segments, notes |

**Events server → client:**

| Event | Trigger | Payload |
|---|---|---|
| `session_established` | On connect | `{ reconnectToken, expiresAt }` |
| `meeting_status` | Any status change for meetings in `meetings_monitor` | `{ meetingId, status }` |
| `transcript_segment` | Deepgram results for meetings supervisor has joined | `SegmentRow` |
| `note_added/updated/deleted` | Note operations in meetings supervisor has joined | Same payloads |
| `video_available/play_sync/pause_sync/seek_sync` | Video events in joined meetings | Same payloads |

**Agora role:** Supervisor always receives `SUBSCRIBER` token — never publishes mic or camera. This is enforced by `AgoraTokenService.generateToken({ role: 'subscriber' })`.

**Language filter:** Both `subscribe_active_meetings` and `join_room` check that `candidate.language === supervisor.language`. Mismatched joins return 403 FORBIDDEN.

---

## 8. Meeting Lifecycle

### Status Values

| Status | Meaning |
|---|---|
| `open` | Candidate created a solo room; no interviewer yet; Deepgram is running |
| `waiting` | Legacy: candidate in queue, no meeting row yet (currently unused in primary flow) |
| `claimed` | Legacy: interviewer claimed candidate; CLAIM_TTL running |
| `connecting` | Legacy: candidate accepted claim; Agora joining |
| `active` | Interviewer joined; both in Agora channel |
| `interrupted` | A participant's socket dropped; grace timer running |
| `ended` | Meeting terminated; terminal state |
| `cancelled` | Cancelled before reaching active; terminal state |

### Valid Transitions

```
interviewer_join: open → active
claim:           waiting → claimed
candidate_join:  claimed → connecting
both_connected:  connecting → active
disconnect:      connecting|active → interrupted
reconnect:       interrupted → active
end:             open|active|interrupted → ended
claim_expired:   claimed → waiting
grace_expired:   interrupted → ended
cancel:          waiting|claimed|connecting → cancelled
```

### What triggers each transition

| Trigger | Event |
|---|---|
| Candidate socket connects, calls `start_session` | `open` room created |
| Interviewer calls `join_open_meeting` | `open → active` via `onInterviewerJoin` |
| Any participant socket drops (non-intentional) | `active → interrupted` via `onParticipantDisconnect` |
| Disconnected participant socket reconnects | `interrupted → active` via `onParticipantReconnect` |
| `GRACE_WINDOW_SECONDS` elapse without reconnect | `interrupted → ended` via BullMQ `grace_expiry` job |
| Interviewer emits `end_meeting` | `any→ended` via `endMeeting` |
| Candidate socket disconnects while status=open | `open→ended` via `endMeeting('candidate_left')` |

### Side effects on transition

| Transition | Side effects |
|---|---|
| `open` created | `deepgramManager.start(meetingId, candidateId)`; `openRoomsUpdate()` broadcast |
| `open → active` | `deepgramManager.start()` called again (idempotent guard); `meeting_status active` broadcast; `openRoomsUpdate()` removes room |
| `active → interrupted` | `scheduleGraceExpiry(meetingId, now)` — BullMQ delayed job |
| `interrupted → active` | `scheduler.cancel('grace_expiry:...')` |
| `any → ended` | `scheduler.cancel('grace_expiry:...')`; `transcriptService.flush(meetingId)`; `transcriptService.clearSeqCounter(meetingId)`; `deepgramManager.stop(meetingId)`; `meeting_status ended` broadcast |
| `grace_expiry` fires | Calls `endMeeting(meetingId, 'grace_expired')` |

---

## 9. Authentication Flow

### Initial Login (Web)

```
1. User signs in via Supabase email/password (browser → Supabase Auth)
2. Client calls POST /auth/session with the Supabase access_token
3. Server calls supabaseAdmin.auth.getUser(token) to verify
4. Server upserts user into users table (role + language from Supabase user_metadata)
5. Server issues internal JWT: { userId, email, role, orgId, language } signed with JWT_SECRET
   - Default TTL: 15m (JWT_EXPIRES_IN)
6. Client stores token in localStorage via tokenStorage
```

### Token Refresh

```
1. On page load: useAuthStore.rehydrate() parses stored JWT
2. If payload.exp < now: useAuthStore.tryRefresh(expiredToken)
   - Calls POST /auth/refresh with the expired token
   - Server decodes without verifying expiry, checks exp + REFRESH_GRACE_MS (1 hour)
   - If within grace: verifies user still exists in Supabase + DB; reissues JWT
3. AppInit gates route render on hydrated:true — prevents ProtectedRoute race
```

### Socket Auth

```
1. getSocket(role) reads current token from auth store or localStorage
2. Sends { token } in handshake.auth
3. requireJwtSocket middleware on each namespace verifies via verifyInternalJwt()
4. On auth failure: 'connect_error' event → client calls logout() + disconnectAll()
```

### Reconnect Tokens (one-shot)

```
1. On every socket connect: server issues SessionService.create(userId)
   - Stores reconnect_token (256-bit base64url) in sessions table with TTL = SESSION_TTL_SECONDS
   - Emits session_established to client
2. Client stores token in sessionStorage (per-role key)
3. On next connect: client sends { token, reconnect_token } in handshake.auth
4. attachReconnectSession middleware: SessionService.findByToken() → DELETE...RETURNING
   - Atomic consume prevents replay attacks
   - Attaches SessionRecord to socket.data.session
5. Use case: seamless reconnect after tab refresh within SESSION_TTL_SECONDS window
```

---

## 10. Key Domain Services

### `MeetingService` (`server/src/domain/MeetingService.ts`)

**Responsibility:** All meeting lifecycle state transitions. The single source of truth for meeting status.

**Key methods:**
- `createOpenMeeting(candidateId)` — inserts meeting at 'open', transitions presence offline→in_meeting, starts Deepgram
- `onInterviewerJoin(meetingId, interviewerId)` — transitions open→active, sets started_at, returns agoraChannel
- `onParticipantDisconnect(meetingId, userId)` — transitions active→interrupted, schedules grace expiry
- `onParticipantReconnect(meetingId, userId)` — transitions interrupted→active, cancels grace timer
- `endMeeting(meetingId, reason)` — terminal transition; flushes transcript; stops Deepgram
- `resumeOrAttachCurrentMeeting(userId, role)` — reconnect lookup (status IN 'open','claimed','connecting','active','interrupted')

**Dependencies:** `Pool`, `IScheduler`, `TranscriptService`, `DeepgramManager`

---

### `TranscriptService` (`server/src/domain/TranscriptService.ts`)

**Responsibility:** Append-only write buffer for transcript segments + note CRUD.

**Key design:** Segments are buffered in memory (per meeting) and batch-written every 500ms or when the buffer reaches 20 segments (`BATCH_SIZE`). This keeps the Deepgram callback path off the DB hot path.

**Key methods:**
- `appendSegment(params)` — assigns seq (counter per meeting, lazily loaded from DB), buffers, returns {id, seq} immediately
- `flush(meetingId?)` — flushes buffer to DB using `unnest()` batch insert
- `getSegments(meetingId, afterSeq, limit)` — pagination by seq
- `addNote / updateNote / deleteNote` — standard CRUD; `updateNote` / `deleteNote` enforce author ownership

---

### `DeepgramManager` (`server/src/lib/DeepgramManager.ts`)

**Responsibility:** Manages one Deepgram live WebSocket session per active meeting.

**Key design:**
- Model: Nova-2, linear16, 16kHz, 1 channel, interim results, endpointing=300ms
- Audio buffered (up to `MAX_BUFFERED_AUDIO_BYTES` = 160KB ≈ 5 seconds) while connection is initialising/reconnecting
- Exponential backoff reconnect: 500ms → 1s → 2s → 4s (max 3 retries)
- On reconnect after gap: inserts a `[transcription gap: Xs]` system segment
- After max retries: calls `onFatalError(meetingId, err)` which triggers `broadcast.transcriptError()`

**Key methods:**
- `start(meetingId, candidateId)` — creates session, opens Deepgram connection
- `send(meetingId, chunk)` — forwards PCM buffer; buffers if not connected
- `stop(meetingId)` — closes connection, clears buffer, deletes session
- `stopAll()` — graceful shutdown

---

### `BullScheduler` / `MemoryScheduler` (`server/src/scheduler/bullScheduler.ts`)

**Responsibility:** Delayed job execution for grace expiry and claim expiry timers.

**`BullScheduler`** (when Redis is available):
- Uses BullMQ Queue + Worker against `meeting-jobs` queue
- Jobs persist in Redis across server restarts
- Job IDs are deterministic (`grace_expiry:<meetingId>`) enabling idempotent cancel

**`MemoryScheduler`** (Redis unavailable fallback):
- In-process `setTimeout`-based; jobs are lost on restart
- Implements same `IScheduler` interface as BullScheduler

**Handler registration:** `scheduler.registerHandler('grace_expiry', fn)` + `scheduler.registerHandler('claim_expiry', fn)` called in `server.ts` before `scheduler.start()`.

---

### `BroadcastHelper` (`server/src/socket/broadcast.ts`)

**Responsibility:** Centralises all server→client socket emits. Domain services never import socket internals.

**Key methods:**
- `transcriptSegment(meetingId, segment)` — emits to all 3 namespaces in `meeting:<id>` room
- `meetingStatus(meetingId, status, extra?)` — emits to all 3 namespaces; also invalidates Redis active-meetings cache keys
- `openRoomsUpdate()` — fetches subscribed interviewer sockets in `open_rooms_monitor` room; emits language-specific open rooms list (Redis-cached 5s)
- `presenceDelta(candidates)` — emits `candidate_queue_update` to interviewer + supervisor namespaces
- `noteAdded/noteUpdated/noteDeleted` — emits to all 3 namespaces in meeting room
- `transcriptError` — emits to all 3 namespaces in meeting room

---

### `PresenceService` (`server/src/domain/PresenceService.ts`)

**Responsibility:** Tracks candidate presence state (offline/waiting) outside of meetings.

**Key methods:**
- `setWaiting(userId, socketId)` — upserts presence row to 'waiting'; guards against race with active meeting
- `heartbeat(userId)` — updates `last_heartbeat_at` only
- `setOffline(userId)` — transitions waiting|claimed → offline; silently skips if candidate is in meeting (MeetingService owns that)
- `getWaitingCandidates()` — FIFO queue snapshot with prior interview count
- `broadcastPresenceDelta(userIds)` — always broadcasts fresh full snapshot (parameter is ignored)

---

## 11. Client Architecture

### Pages (Routes)

| Route | Page | Role | Socket Namespace |
|---|---|---|---|
| `/` | `LoginPage` | All | None (Supabase auth) |
| `/register` | `RegisterPage` | All | None |
| `/candidate` | `CandidateWaitingRoom` | candidate | `/candidate` |
| `/interviewer` | `InterviewerDashboard` | interviewer | `/interviewer` |
| `/supervisor` | `SupervisorDashboard` | supervisor | `/supervisor` |
| `/room/:roomId` | `InterviewRoom` | all | role-specific |

### Zustand Stores

#### `useAuthStore` (`client/src/store/useAuthStore.js`)
| Field / Action | Type | Description |
|---|---|---|
| `user` | `{ userId, email, role, name, language } \| null` | Current user |
| `token` | `string \| null` | Internal JWT |
| `isAuthenticated` | `boolean` | |
| `hydrated` | `boolean` | False until rehydrate/tryRefresh settles; gates AppInit |
| `login(user, token)` | action | Sets state + stores token in localStorage |
| `logout()` | action | Clears state + localStorage |
| `rehydrate()` | action | Sync: reads localStorage JWT, validates, sets state |
| `tryRefresh(expiredToken)` | action | Async: calls POST /auth/refresh |

Module-level boot block runs `rehydrate()` at import time (before any React render).

#### `useMeetingStore` (`client/src/store/useMeetingStore.js`)
| Field / Action | Type | Description |
|---|---|---|
| `meetingId` | `string \| null` | Active meeting UUID |
| `agoraChannel` | `string \| null` | Agora channel name |
| `agoraUid` | `number \| null` | Local Agora UID |
| `candidateId` | `string \| null` | |
| `interviewerId` | `string \| null` | |
| `candidateName` | `string \| null` | |
| `interviewerName` | `string \| null` | |
| `interviewerAgoraUid` | `number \| null` | |
| `candidateAgoraUid` | `number \| null` | |
| `status` | `string` | Mirrors MeetingStatus + 'idle' |
| `setMeetingJoined(payload)` | action | Sets all meeting fields |
| `applyMeetingStatus({ meetingId, status })` | action | Status update from socket |
| `clearMeeting()` | action | Full reset to initialState |

#### `useTranscriptStore` (`client/src/store/useTranscriptStore.js`)
| Field / Action | Type | Description |
|---|---|---|
| `segments` | `SegmentRow[]` | Ordered by seq; finals only |
| `interimSegment` | `{ text } \| null` | Live partial (not persisted) |
| `notes` | `NoteRow[]` | Ordered by createdAt |
| `transcriptionFailed` | `boolean` | Set on Deepgram fatal error |
| `addSegment(segment)` | action | Deduplicates by id |
| `mergeCatchupData({ segments, notes })` | action | Map-merge for reconnect/hydration |
| `addNote / updateNote / removeNote` | actions | Note CRUD |
| `clearTranscript()` | action | Full reset |

### Hooks

| Hook | File | What it manages |
|---|---|---|
| `useSocket` | `hooks/useSocket.js` | Module-level singletons; `getSocket(role)`, reconnect token in sessionStorage, `session_established` / `session_replaced` handlers |
| `useAgora` | `hooks/useAgora.js` | Agora RTC client lifecycle: join, leave, publish, subscribe, mute, camera, AudioContext resume on visibility change |
| `useTranscript` | `hooks/useTranscript.js` | AudioWorklet pipeline → PCM capture → `audio_chunk` emit; heartbeat timer (10s); handles mute/unmute and AudioContext suspend/resume |
| `useVideoResume` | `hooks/useVideoResume.js` | Signed upload URL fetch, PUT to Supabase Storage, POST /videos to register |

### `InterviewRoom` Component Tree

```
InterviewRoom (pages/InterviewRoom.jsx)
├── [Header] — logo + meeting ID + language badge + connection dot
├── [ConnectionLostBanner] — shown when Socket.IO disconnects
│
├── [Mobile layout] (< md breakpoint)
│   ├── VideoGrid (aspect-video, max-h-40vh)
│   │   └── MobileAvatarStack — overlapping initials
│   ├── PanelContent (flex-1) — active tab content
│   │   ├── TranscriptBox
│   │   ├── NotesPanel
│   │   ├── VideoResumePanel
│   │   └── HistoryPanel (lazy-mounted)
│   └── [Bottom bar] — mic, cam, tab icons, end call
│
├── [Desktop layout] (>= md)
│   ├── [Left 60%]
│   │   ├── VideoGrid (aspect-video)
│   │   └── ParticipantPanel
│   ├── [Right 40%]
│   │   ├── [Tab bar] — Transcript, Notes, Video, History
│   │   └── PanelContent — active tab
│   └── RoomControls (bottom bar)
│
├── [InterruptedOverlay] — grace countdown; shown when status=interrupted
└── [TerminatedOverlay] — 5-second countdown + redirect; shown when status=ended
```

---

## 12. Real-Time Data Flows

### Flow 1: Candidate starts session → appears on interviewer dashboard

```
1. Candidate connects to /candidate (JWT auth, reconnect token attached)
2. Server: requireJwtSocket verifies JWT → socket.data.user set
3. Server: SessionService.create() → emits session_established to candidate
4. Server: resumeOrAttachCurrentMeeting() → no active meeting → skip reconnect path
5. Candidate emits: start_session {}
6. Server: MeetingService.createOpenMeeting(userId)
   a. DB: INSERT INTO meetings (status='open')
   b. DB: UPDATE candidate_presence (status='in_meeting')
   c. deepgramManager.start(meetingId, candidateId) → opens Deepgram WebSocket
7. Server: socket.join('meeting:<meetingId>')
8. Server: emits meeting_attached to candidate socket (with agoraToken, uid, channel)
9. Server: broadcast.openRoomsUpdate()
   a. Fetches all sockets in 'open_rooms_monitor' room
   b. For each: fetches language-filtered open rooms from DB (or Redis cache)
   c. Emits open_rooms_update { meetings } to each interviewer socket
10. Interviewer dashboard: onOpenRoomsUpdate → setOpenRooms → re-renders room list
```

### Flow 2: Interviewer joins → both enter InterviewRoom

```
1. Interviewer emits: join_open_meeting { meetingId }
2. Server: language pre-flight (candidate.language === interviewer.language)
3. Server: MeetingService.onInterviewerJoin(meetingId, interviewerId)
   a. DB: UPDATE meetings SET status='active', interviewer_id=..., started_at=now()
   b. deepgramManager.start() called (idempotent — already running for candidate)
4. Server: socket.join('meeting:<meetingId>')
5. Server: AgoraTokenService.generateToken(agoraChannel, uid, 'publisher')
6. Server: broadcast.meetingStatus(meetingId, 'active', { interviewerName, participantUids })
   - Emits meeting_status to /interviewer + /candidate meeting:<id> rooms
7. Candidate socket receives meeting_status { status:'active', interviewerName, participantUids }
   - applyMeetingStatus('active')
   - setMeetingJoined({ interviewerName, interviewerAgoraUid })
   - InterviewRoom: cleared interrupted overlay; joinChannel(agoraToken, uid) already called
8. Server: broadcast.openRoomsUpdate() removes this room from interviewer dashboards
9. Interviewer receives meeting_attached { agoraToken, uid, ... }
10. InterviewerDashboard: onMeetingAttached → setMeetingJoined; navigate('/room/<meetingId>')
11. Both call useAgora.joinChannel() → AgoraRTC.join → publish local tracks
```

### Flow 3: Candidate speaks → transcript appears on both screens

```
1. useTranscript hook: AudioWorklet captures PCM at 16kHz
   - workletNode.port.onmessage → socket.emit('audio_chunk', buffer)
2. Candidate socket /candidate: audio_chunk handler
   - Guards: meetingId set, meetingStatus in ['active','open'], in meeting room
   - Byte rate limit: 200KB/s window; excess chunks dropped
   - deepgramManager.send(meetingId, chunk)
3. DeepgramManager: client.send(ArrayBuffer) → Deepgram WebSocket
4. Deepgram: returns Transcript event (interim or final)
5. For finals only: DeepgramManager.handleTranscript()
   a. transcriptService.appendSegment(params) → buffers; returns {id, seq}
   b. deps.onSegment(meetingId, segment) → broadcast.transcriptSegment(meetingId, segment)
6. BroadcastHelper.transcriptSegment():
   - io.of('/interviewer').to('meeting:<id>').emit('transcript_segment', segment)
   - io.of('/candidate').to('meeting:<id>').emit('transcript_segment', segment)
   - io.of('/supervisor').to('meeting:<id>').emit('transcript_segment', segment)
7. InterviewRoom (all roles): onTranscriptSegment → addSegment(segment) → re-render TranscriptBox
8. TranscriptService flush interval (500ms): batch-writes buffered segments to DB
```

### Flow 4: Video uploaded → appears for both parties

```
1. Candidate (or interviewer) triggers upload in VideoResumePanel
2. useVideoResume.startUpload():
   a. POST /meetings/<id>/videos/upload-url → { uploadUrl, storagePath }
   b. PUT <uploadUrl> (direct to Supabase Storage)
   c. POST /meetings/<id>/videos { storagePath, type, candidateName } → { videoId }
3. User emits share_video { meetingId, videoId }
4. Server candidate.ts or interviewer.ts share_video handler:
   a. DB query: SELECT storage_path FROM meeting_videos WHERE id=$1 AND meeting_id=$2
   b. supabaseAdmin.storage.createSignedUrl(storagePath, 3600) → signedUrl
   c. Emits video_available { videoId, signedUrl, sharedBy } to:
      - /interviewer in meeting room
      - /candidate in meeting room
      - /supervisor in meeting room
5. InterviewRoom: onVideoAvailable → setSharedVideo(payload)
   - Switches to 'video' tab if tab is 'transcript' etc.
   - VideoResumePanel shows the shared video with sync controls
```

### Flow 5: Meeting ends → both navigate away, data stored

```
1. Interviewer emits: end_meeting { meetingId, reason:'interviewer_ended' }
2. Server: MeetingService.endMeeting(meetingId, reason)
   a. DB: UPDATE meetings SET status='ended', ended_at=now(), end_reason=...
   b. DB: UPDATE candidate_presence SET status='offline', current_meeting_id=NULL
   c. scheduler.cancel('grace_expiry:<meetingId>')
   d. transcriptService.flush(meetingId) → final DB batch write
   e. transcriptService.clearSeqCounter(meetingId)
   f. deepgramManager.stop(meetingId) → requestClose(); delete session
3. Server: broadcast.meetingStatus(meetingId, 'ended')
   - BroadcastHelper invalidates Redis active-meetings cache keys
   - Emits meeting_status { meetingId, status:'ended' } to all 3 namespaces in meeting room
4. Both clients receive meeting_status 'ended':
   - InterviewRoom: setTerminated(true); clearInterval(interruptedTimer)
5. Terminated overlay shows 5-second countdown
6. After 5s: clearMeeting(); clearTranscript(); navigate('/interviewer' or '/candidate')
7. On disconnect: socket.data.meetingStatus = 'ended' → audio_chunk handler drops all audio
```

---

## 13. Feature List

| Feature | Status | Description |
|---|---|---|
| Candidate waiting room | Working | Camera/mic preview, start session button |
| Open room creation | Working | Candidate creates solo room on start_session |
| Live open rooms list | Working | Interviewer sees language-filtered real-time list |
| Interviewer join | Working | Clickable join transitions room open→active |
| Language separation | Working | Interviewers/supervisors only see their language |
| Agora RTC video/audio | Working | Two-way video with mute/camera-off controls |
| Live transcription | Working | Deepgram Nova-2, finals only, server-side |
| Transcript broadcast | Working | Real-time segments to all 3 roles |
| Timestamped notes | Working | Anchor notes to transcript segments |
| Note CRUD | Working | Add/edit/delete by author; broadcast to all |
| Video resume upload | Working | Candidate uploads video to Supabase Storage |
| Video sharing | Working | share_video emits signed URL to all parties |
| Synchronized playback | Working | play/pause/seek sync across candidate/interviewer/supervisor |
| Meeting history | Working | Candidate can view past interview transcripts + notes |
| Candidate history modal | Working | Interviewer can view any candidate's past meetings |
| Supervisor stealth monitoring | Working | Subscriber-only Agora token; no audio/video published |
| Supervisor active meetings dashboard | Working | Language-filtered grid; Redis-cached 5s |
| Interrupted/grace flow | Working | 30s countdown overlay; auto-ends on expiry |
| Reconnect tokens | Working | One-shot session tokens for seamless page refresh |
| Socket deduplication | Working | Second tab gets session_replaced → evicted |
| Token refresh | Working | 1-hour grace window after JWT expiry |
| Boot-time settle scan | Working | Orphaned active meetings → interrupted on restart |
| Presence sweeper | Working | Stale heartbeats → offline; expired sessions deleted |
| Redis adapter | Working | Optional; falls back to in-memory cleanly |
| BullMQ scheduler | Working | Persistent timers via Redis; MemoryScheduler fallback |
| Metrics endpoint | Working | Active meetings, queue depth, Deepgram sessions |
| Health endpoint | Working | `/health` for Railway healthcheck |
| Mobile responsive layout | Working | Different layout < 768px breakpoint |
| Deepgram gap segments | Working | System segment inserted after reconnect gap |
| Audio buffering | Working | Up to 5s of audio buffered during Deepgram reconnect |

---

## 14. Known Issues and Current State

### Working
- Core interview flow: candidate → waiting room → open room → interviewer joins → both in Agora
- Live transcription pipeline with Deepgram Nova-2
- Grace timer (30s) for disconnects with BullMQ/Redis
- Video upload, sharing, and synchronized playback
- Language-based room separation (english/tamil/hindi)
- Supervisor stealth monitoring
- Mobile layout with bottom navigation bar

### Known Issues / Partially Implemented

1. **Legacy claim flow is dead code.** The `ClaimService`, `PresenceService.setWaiting()`, and the `waiting/claimed/connecting` status path exist but are no longer triggered. The current flow goes `open → active` directly. The legacy path was the precursor; domain code was not removed.

2. **`CandidateJoinPage.jsx` is unreachable.** No route in `App.jsx` points to it. Was the legacy join-by-room-code flow.

3. **`PresenceService.setWaiting()`** is never called in the current flow (candidates go directly to `in_meeting` via `createOpenMeeting`). The heartbeat from `useTranscript` still fires but is handled as a no-op.

4. **Interim transcripts not displayed.** `DeepgramManager` suppresses interim results (comment says "broadcast wired in Phase 10"). Only finals are saved and broadcast.

5. **`meeting_participants` table is written but not read.** `disconnected_at` is set on disconnect/reconnect, but the table is never queried by any service. Likely a future analytics use.

6. **`useRoomStore`** has minimal state and is only used by `RoomGuard` in App.jsx. The guard itself has an incomplete condition (`!isAuthenticated && roomId !== paramRoomId` allows unauthenticated users if roomId matches).

7. **Redis cache invalidation for active meetings** uses hardcoded language keys (`activemeetings:english`, `activemeetings:tamil`, `activemeetings:hindi`) — will silently miss any new language added to the enum without a code change.

8. **Legacy JS files** in `server/src/lib/` (`logger.js`, `supabase.js`) and `server/src/` root (`config.js`, `routes/`, `socket/` old handlers, `state/`, `middleware/`) still exist from before the TypeScript rewrite. They are not imported by the current entry point (`server.ts`). **These should be audited and removed to avoid confusion.**

9. **`server/src/routes/rooms.js` and `server/src/routes/auth.js`** — legacy Express routers from the old JS codebase. Not mounted in `server.ts`.

---

## 15. Deployment Guide

### Railway (Server)

**Build:** `server/Dockerfile` → `node:22-alpine`, runs `npm install --omit=dev`, copies `src/`

**Start command:** `npm start` → `node --import tsx/esm src/server.ts`

**Required environment variables on Railway:**

```
DATABASE_URL=<supabase-direct-connection-string>
JWT_SECRET=<min-32-chars-random-string>
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
AGORA_APP_ID=<agora-app-id>
AGORA_APP_CERTIFICATE=<agora-app-certificate>
DEEPGRAM_API_KEY=<deepgram-key>
CLIENT_ORIGIN=https://<your-vercel-app>.vercel.app
REDIS_URL=rediss://<upstash-url>  # Optional but recommended for grace timers
```

**Health check:** `/health` (configured in `railway.json`, 30s timeout)

**Restart policy:** `ON_FAILURE`, max 3 retries

### Vercel (Client)

**Build command:** `npm run build:client` (from repo root) or `vite build` in `client/`

**Output directory:** `client/dist/`

**SPA routing:** `client/vercel.json` rewrites all paths to `/index.html`

**Required environment variables on Vercel:**

```
VITE_API_URL=https://<your-railway-app>.railway.app
VITE_SOCKET_URL=https://<your-railway-app>.railway.app
VITE_AGORA_APP_ID=<agora-app-id>
```

### Supabase Manual Setup

1. **Run migrations** in order via Supabase SQL editor or `npm run migrate` (from `server/`):
   - `server/migrations/0001_init.sql`
   - `server/migrations/0002_open_meetings.sql`
   - `server/migrations/0003_open_meetings_schema.sql`
   - `server/migrations/0004_meeting_videos.sql`
   - `server/src/migrations/0005_language.sql`

2. **Create Storage bucket:**
   - Name: `interview-videos`
   - Public: OFF
   - File size limit: 200MB
   - Allowed MIME: `video/mp4, video/webm, video/quicktime`

3. **Seed users** via Supabase Auth Dashboard → Users → Invite user:
   - Set `user_metadata.role` = `interviewer` or `supervisor` or `candidate`
   - Set `user_metadata.language` = `english` | `tamil` | `hindi`
   - Set `user_metadata.full_name` = display name

### Redis / Upstash Setup (Optional)

1. Create an Upstash Redis database (free tier available)
2. Copy the `REDIS_URL` (rediss:// format)
3. Set as Railway env var
4. Without Redis: MemoryScheduler is used (grace timers lost on restart); no Socket.IO Redis adapter

---

## 16. Recent Changes (Reverse Chronological)

| Commit | Change |
|---|---|
| `059b880` | Fix `openRoomsUpdate` logging; raise `start_session` rate limit from 3 to 20/min; reset rate limit bucket when candidate navigates back from ended meeting |
| `f82cd25` | Fix `start_session` hang: Redis is optional for `fetchSockets` (3s timeout race); guaranteed ack path; clear stale `meetingId` if previous meeting ended |
| `ed3abbb` | Fix video elongation on history tab; fix `video_available` missed when tab was inactive (used `startTransition` for `setSharedVideo`) |
| `397b493` | Add `REDIS_URL` environment variable support |
| `8397867` | Fix production start script: use `node --import tsx/esm` instead of `tsx`; add `tsx` to production dependencies in Dockerfile |
| `b741a3a` | Language separation feature: `0005_language.sql` migration; language-filtered open rooms and active meetings; supervisor language pre-flight on `join_room`; language badge in InterviewRoom header |
| `6a944f6` | Fix interviewer video tile showing raw UID on candidate's screen (send `interviewerName` in `meeting_status active` broadcast) |
| `305c7f4` | Add authenticated candidate support; register/login/join flows with Supabase; JWT auth required on `/candidate` namespace |
| `fe527f3` | Fix transcript pipeline after mute/unmute; harden Agora/socket lifecycle; AudioContext auto-resume on visibility change and focus |
| `b5ab162` | Refactor to TypeScript server; domain services architecture; BullMQ scheduler; Socket.IO namespaces; open-meeting flow replacing legacy claim flow |
