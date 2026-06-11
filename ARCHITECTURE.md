# RecruitMonitor — Architecture Reference

> **Last updated: June 2025.** Source of truth: read the code. This document is a navigation guide, not a spec.

---

## 1. Overview

RecruitMonitor is a real-time interview monitoring platform with three roles:

| Role | Entry point | Agora mode | Socket namespace |
|------|------------|------------|-----------------|
| Candidate | `/join/:code` | Publisher (video + audio) | `/candidate` |
| Interviewer | `/interviewer` dashboard | Publisher (video + audio) | `/interviewer` |
| Supervisor | `/supervisor` dashboard | Subscriber only (no publish) | `/supervisor` |

Interviews are language-separated (English / Tamil / Hindi). Interviewers only see rooms in their own language. Supervisors joining a cross-language meeting are explicitly rejected (`FORBIDDEN`).

---

## 2. Tech Stack

### Server (`server/`)

| Layer | Package | Version | Notes |
|-------|---------|---------|-------|
| Runtime | Node.js | 22 (alpine) | `node --import tsx/esm src/server.ts` |
| HTTP | Express | 4.x | `cors`, `helmet`, `pino-http` |
| WebSockets | Socket.IO | 4.7 | 3 namespaces; Redis adapter optional |
| Database | `pg` | 8.12 | Pool **max 50**; non-pooled Supabase connection (port 6543) |
| Redis | `ioredis` | 5.11 | **Optional** — `null` when `REDIS_URL` absent |
| Socket.IO adapter | `@socket.io/redis-adapter` | 8.3 | Attached only when Redis is available |
| Job queue | `bullmq` | 5.78 | Persistent delayed jobs; Redis-backed; falls back to `MemoryScheduler` |
| Auth — internal | `jsonwebtoken` | 9.x | HS256, 15m TTL, 1h refresh grace |
| Auth — Supabase | `@supabase/supabase-js` | 2.x | Token verification + Storage |
| Transcription | `@deepgram/sdk` | 3.5 | Nova-2 live; server-side pipeline |
| Video tokens | `agora-token` | 2.0.4 | Server-side RTC token generation |
| Logging | `pino` | 9.x | JSON structured logging |
| Validation | `zod` | 3.x | Env schema; `process.exit(1)` on missing vars |

### Client (`client/`)

| Layer | Package | Version | Notes |
|-------|---------|---------|-------|
| Framework | React | 19 | No StrictMode (breaks Agora/Socket.IO lifecycle) |
| Build | Vite | 6.x | `@vitejs/plugin-react` |
| Styling | Tailwind CSS | 3.x | Teal primary, zinc surface, Geist font |
| State | Zustand | 5.0.13 | 3 stores: auth, meeting, transcript |
| WebSockets | `socket.io-client` | 4.7 | Module-level singleton sockets |
| Video / Audio | `agora-rtc-sdk-ng` | 4.24.3 | `useAgora` hook |
| HTTP | `axios` | 1.x | Auth interceptor; `/api` proxy via Vite |

---

## 3. Project Structure

```
interview-platform/
├── client/
│   ├── src/
│   │   ├── App.jsx                    # Routes, ProtectedRoute, RoomGuard, AppInit
│   │   ├── main.jsx                   # No StrictMode — deliberate
│   │   ├── index.css                  # Component classes: glass-card, btn-*, etc.
│   │   ├── pages/
│   │   │   ├── LoginPage.jsx
│   │   │   ├── RegisterPage.jsx
│   │   │   ├── CandidateJoinPage.jsx
│   │   │   ├── CandidateWaitingRoom.jsx
│   │   │   ├── InterviewerDashboard.jsx
│   │   │   ├── SupervisorDashboard.jsx
│   │   │   └── InterviewRoom.jsx
│   │   ├── components/
│   │   │   ├── VideoGrid.jsx
│   │   │   ├── TranscriptBox.jsx
│   │   │   ├── NotesPanel.jsx
│   │   │   ├── HistoryPanel.jsx
│   │   │   ├── VideoResumePanel.jsx
│   │   │   ├── RoomControls.jsx
│   │   │   ├── ParticipantPanel.jsx
│   │   │   ├── ActiveRoomCard.jsx
│   │   │   └── CandidateHistoryModal.jsx
│   │   ├── hooks/
│   │   │   ├── useSocket.js           # Module-level singletons; reconnect session storage
│   │   │   ├── useAgora.js            # Agora RTC; supervisor skips publish; _sv_ filtering
│   │   │   └── useTranscript.js       # AudioWorklet pipeline; 10s heartbeat; 15s health check
│   │   └── store/
│   │       ├── useAuthStore.js        # rehydrate() sync; tryRefresh() async; hydrated flag
│   │       ├── useMeetingStore.js     # applyMeetingStatus(); clearMeeting(); no agoraToken stored
│   │       └── useTranscriptStore.js  # mergeCatchupData(); addSegment() deduplication
│   ├── tailwind.config.js
│   ├── vite.config.js
│   └── vercel.json                    # SPA rewrite: * → /index.html
└── server/
    ├── src/
    │   ├── server.ts                  # Boot sequence, service wiring, graceful shutdown
    │   ├── config/
    │   │   └── env.ts                 # Zod schema; exits on missing required vars
    │   ├── auth/
    │   │   ├── jwt.ts                 # issueInternalJwt, verifyInternalJwt, decodeExpiredJwt
    │   │   └── supabase.ts            # verifySupabaseToken via supabaseAdmin.auth.getUser
    │   ├── db/
    │   │   ├── pool.ts                # pg Pool max 50; checkDbConnection()
    │   │   └── redis.ts               # ioredis client (null if no REDIS_URL); waitForRedis; disconnectRedis
    │   ├── domain/
    │   │   ├── MeetingService.ts      # All meeting lifecycle methods
    │   │   ├── meetingMachine.ts      # Pure state machine; MEETING_TRANSITIONS lookup table
    │   │   ├── TranscriptService.ts   # unnest() batch insert; 500ms / 20-segment flush
    │   │   ├── AgoraTokenService.ts   # deriveUid() SHA-256; generateToken()
    │   │   ├── PresenceService.ts     # setWaiting, heartbeat, setOffline, broadcastPresenceDelta
    │   │   ├── SessionService.ts      # Reconnect tokens; DELETE…RETURNING (atomic consume)
    │   │   └── ClaimService.ts        # Legacy claim flow (unused in primary open-room flow)
    │   ├── http/
    │   │   ├── auth.ts                # /auth/session, /auth/refresh, /auth/me
    │   │   ├── meetings.ts            # GET /meetings/:id, /transcript, /notes
    │   │   ├── videos.ts              # POST upload-url, GET stream-url; bucket: interview-videos
    │   │   ├── candidates.ts          # Candidate history endpoints
    │   │   └── metrics.ts             # GET /metrics — requires supervisor/admin JWT
    │   ├── lib/
    │   │   ├── DeepgramManager.ts     # Live transcription; exp backoff; 160KB audio buffer
    │   │   ├── supabase.ts            # Admin client; exits if any Supabase env var missing
    │   │   ├── logger.ts              # pino instance
    │   │   ├── errors.ts              # DomainError with typed code
    │   │   └── ids.ts                 # newId() — cuid2
    │   ├── scheduler/
    │   │   ├── bullScheduler.ts       # BullScheduler (BullMQ) + MemoryScheduler (fallback); IScheduler interface
    │   │   ├── recovery.ts            # Boot: only deletes expired sessions; no timer reconstruction
    │   │   └── sweeper.ts             # startPresenceSweeper(); marks stale waiting → offline
    │   └── socket/
    │       ├── io.ts                  # createSocketServer(); Redis adapter conditional attach
    │       ├── broadcast.ts           # BroadcastHelper; openRoomsUpdate() async + Redis cache
    │       ├── rateLimiter.ts         # In-process token bucket; checkSocketRateLimit; resetSocketRateLimit
    │       ├── middleware/
    │       │   ├── requireJwtSocket.ts      # JWT auth; role → namespace check
    │       │   └── attachReconnectSession.ts # Fail-soft reconnect token reader
    │       └── namespaces/
    │           ├── candidate.ts       # /candidate; start_session 20/min; audio_chunk 200KB/s
    │           ├── interviewer.ts     # /interviewer; join_open_meeting, join_room, end_meeting
    │           └── supervisor.ts      # /supervisor; subscribe_active_meetings; Redis cache 5s TTL
    └── migrations/
        ├── 0001_init.sql              # All enums, tables, indexes
        ├── 0002_open_meetings.sql     # ADD VALUE 'open' to meeting_status
        ├── 0003_open_meetings_schema.sql # interviewer_id nullable; partial unique index update
        ├── 0004_meeting_videos.sql    # meeting_videos table; Storage setup instructions
        └── src/migrations/
            └── 0005_language.sql      # ALTER TABLE users ADD COLUMN language TEXT
```

---

## 4. Environment Variables

### Server (`server/.env`)

| Variable | Required | Notes |
|----------|----------|-------|
| `PORT` | Yes | Default 4000; Railway sets automatically |
| `NODE_ENV` | Yes | `development` / `production` |
| `JWT_SECRET` | Yes | Min 32 chars |
| `CLIENT_ORIGIN` | Yes | Comma-separated allowed origins |
| `AGORA_APP_ID` | Yes | |
| `AGORA_APP_CERTIFICATE` | Yes | For token signing |
| `AGORA_TOKEN_TTL_SECONDS` | No | Default 3600 |
| `DEEPGRAM_API_KEY` | Yes | |
| `SUPABASE_URL` | Yes | `lib/supabase.ts` exits if missing |
| `SUPABASE_ANON_KEY` | Yes | `lib/supabase.ts` exits if missing |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | `lib/supabase.ts` exits if missing |
| `REDIS_URL` | **No** | Optional; falls back to in-memory if absent or timeout |
| `GRACE_WINDOW_SECONDS` | No | Grace period after participant disconnect |
| `CLAIM_TTL_SECONDS` | No | Claim expiry (legacy flow) |
| `SESSION_TTL_SECONDS` | No | Reconnect token TTL |
| `PRESENCE_SWEEPER_INTERVAL_SECONDS` | No | |
| `PRESENCE_STALE_AFTER_SECONDS` | No | Heartbeat staleness threshold |

### Client (`client/.env`)

| Variable | Notes |
|----------|-------|
| `VITE_API_URL` | HTTP base URL (`http://localhost:4000` in dev) |
| `VITE_SOCKET_URL` | Socket.IO server URL |
| `VITE_AGORA_APP_ID` | Same Agora app as server |

---

## 5. Database Schema

PostgreSQL hosted on Supabase. Connected via `pg` pool (**max 50**, non-pooled endpoint — port 6543).

### Enums

```sql
CREATE TYPE meeting_status AS ENUM (
  'open', 'waiting', 'claimed', 'connecting', 'active',
  'interrupted', 'ended', 'cancelled'
);
CREATE TYPE user_role AS ENUM ('candidate', 'interviewer', 'supervisor', 'admin');
```

### Core Tables

**`users`**
```sql
id            UUID PRIMARY KEY
email         TEXT UNIQUE NOT NULL
role          user_role NOT NULL
org_id        UUID
language      TEXT NOT NULL DEFAULT 'english'  -- CHECK IN ('english','tamil','hindi')
created_at    TIMESTAMPTZ
```

**`meetings`**
```sql
id              UUID PRIMARY KEY
candidate_id    UUID REFERENCES users(id)
interviewer_id  UUID REFERENCES users(id)  -- NULLABLE (NULL for status='open')
org_id          UUID
status          meeting_status NOT NULL DEFAULT 'waiting'
language        TEXT NOT NULL DEFAULT 'english'
room_code       TEXT UNIQUE
started_at      TIMESTAMPTZ
ended_at        TIMESTAMPTZ
created_at      TIMESTAMPTZ
```

**`transcript_segments`**
```sql
id          UUID PRIMARY KEY
meeting_id  UUID REFERENCES meetings(id)
speaker     TEXT NOT NULL           -- 'candidate' | 'interviewer'
text        TEXT NOT NULL
start_time  NUMERIC                 -- seconds from meeting start
end_time    NUMERIC
confidence  NUMERIC
created_at  TIMESTAMPTZ
```

**`notes`**
```sql
id            UUID PRIMARY KEY
meeting_id    UUID REFERENCES meetings(id)
author_id     UUID REFERENCES users(id)
body          TEXT NOT NULL
is_free_note  BOOLEAN DEFAULT FALSE  -- free notes visible to candidate
created_at    TIMESTAMPTZ
updated_at    TIMESTAMPTZ
```

**`sessions`** (reconnect tokens)
```sql
id          UUID PRIMARY KEY
user_id     UUID REFERENCES users(id)
meeting_id  UUID
token       TEXT UNIQUE NOT NULL    -- 256-bit base64url; single-use
expires_at  TIMESTAMPTZ
created_at  TIMESTAMPTZ
```

**`meeting_videos`**
```sql
id            UUID PRIMARY KEY
meeting_id    UUID REFERENCES meetings(id)
storage_path  TEXT NOT NULL         -- path in 'interview-videos' Supabase Storage bucket
uploaded_by   UUID
uploaded_at   TIMESTAMPTZ
```

**`candidates`** (presence / queue)
```sql
id               UUID PRIMARY KEY   -- same as users.id
status           TEXT               -- 'waiting' | 'offline'
interview_count  INTEGER DEFAULT 0  -- used for FIFO ordering
joined_queue_at  TIMESTAMPTZ
last_heartbeat   TIMESTAMPTZ
```

---

## 6. Meeting State Machine

Defined in `server/src/domain/meetingMachine.ts` as pure transition lookup tables with no side effects.

### Status flow

```
open ──── interviewer joins open room ─────────────────► active
waiting ── interviewer joins ──────────────────────────► connecting
connecting ─ Agora handshake done ─────────────────────► active
active ──── participant disconnects ───────────────────► interrupted
interrupted ─ grace expires, no rejoin ────────────────► ended
interrupted ─ participant reconnects ──────────────────► active (or connecting)
active / connecting ─ end_meeting ─────────────────────► ended
open / waiting / claimed ─ cancel ─────────────────────► cancelled
```

### State table

| Status | Who's present | Notes |
|--------|---------------|-------|
| `open` | Candidate only | Created by candidate; `interviewer_id = NULL` |
| `waiting` | Candidate only | Legacy claim flow |
| `claimed` | Claim placed, not yet joined | Legacy flow only |
| `connecting` | Both in Agora, handshake in progress | |
| `active` | Full session; Deepgram live | |
| `interrupted` | One side disconnected; grace window open | BullMQ job scheduled |
| `ended` | Permanently finished | Transcript flushed to DB |
| `cancelled` | Never started | |

`guardMeetingTransition()` and `guardCandidateTransition()` throw `InvalidTransitionError` on illegal transitions.

---

## 7. Redis Architecture

Redis is **optional**. At boot, `waitForRedis(5000)` probes connectivity with a 5-second timeout. On failure or absence, `disconnectRedis()` closes the ioredis connection permanently (stops reconnect log spam), and the system falls back to in-memory alternatives.

### Redis client (`server/src/db/redis.ts`)

```ts
export const redis: Redis | null = env.REDIS_URL
  ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, enableReadyCheck: true, ... })
  : null;
```

`redis` is `null` when `REDIS_URL` is not set. All consumers null-check before use.

### Redis usage

| Use | Key pattern | TTL | Notes |
|-----|------------|-----|-------|
| Socket.IO adapter | (internal pub/sub) | — | Cross-instance socket coordination |
| Open rooms cache | `openrooms:{lang}` | 5s | Per-language; invalidated on room state change |
| Active meetings cache | `activemeetings:{lang}` | 5s | Supervisor dashboard |
| BullMQ job store | `bull:meeting-jobs:*` | Job TTL | Grace/claim expiry timers; survive restarts |

### Redis adapter (`server/src/socket/io.ts`)

```ts
if (options.redisAvailable && redis) {
  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();
  io.adapter(createAdapter(pubClient, subClient));
}
```

Two dedicated connections (pub + sub) duplicated from the main `redis` client. Without Redis, Socket.IO uses its default in-memory adapter.

---

## 8. Job Scheduler (BullMQ / MemoryScheduler)

Defined in `server/src/scheduler/bullScheduler.ts`. Both implementations satisfy the `IScheduler` interface.

### `IScheduler`

```ts
interface IScheduler {
  registerHandler(jobName: string, handler: (data: unknown) => Promise<void>): void;
  schedule(jobName: string, data: unknown, delayMs: number, jobId?: string): Promise<void>;
  cancel(jobId: string): Promise<void>;
  start(): void;
  close(): Promise<void>;
  getQueueDepth(): Promise<number>;
}
```

### `BullScheduler` (Redis available)

- BullMQ `Queue` + `Worker` on queue `meeting-jobs`
- Deterministic job IDs prevent duplicate scheduling on reconnect
- Jobs persist in Redis across server restarts — grace timers survive crashes
- Handlers: `grace_expiry` → `meetingService.onGraceExpired()`, `claim_expiry` → `claimService.onClaimExpired()`

### `MemoryScheduler` (Redis unavailable)

- In-process `setTimeout` calls stored in `Map<string, ReturnType<typeof setTimeout>>`
- Jobs lost on server restart — boot-time settle scan partially compensates

### Boot wiring

```ts
const scheduler = redisAvailable ? new BullScheduler() : new MemoryScheduler();
scheduler.registerHandler('grace_expiry', ...);
scheduler.registerHandler('claim_expiry', ...);
scheduler.start();  // starts BullMQ worker; no-op for MemoryScheduler
```

### Recovery (`server/src/scheduler/recovery.ts`)

`recoverScheduledJobs()` runs at boot and **only** deletes expired sessions from the `sessions` table. It does **not** reconstruct timers — BullMQ persists those in Redis automatically.

---

## 9. Socket.IO Architecture

Three namespaces on one HTTP server, created in `server/src/socket/io.ts`.

### Namespaces

| Namespace | Auth | Rate limits | Purpose |
|-----------|------|------------|---------|
| `/candidate` | None (room code is credential) | `start_session`: **20/min**; `audio_chunk`: 200 KB/s | Session start, audio, notes, video sync |
| `/interviewer` | JWT required (`role: interviewer`) | None | Join/end meetings, notes, video |
| `/supervisor` | JWT required (`role: supervisor`) | None | Monitor meetings (stealth) |

### Socket rooms

| Room | Members | Events |
|------|---------|--------|
| `meeting:{meetingId}` | Candidate + interviewer + supervisors | All scoped meeting events |
| `open_rooms_monitor` | Interviewers on dashboard | `open_rooms_update` |
| `meetings_monitor` | Subscribed supervisors | `meeting_status` on any change |

### Middleware

**`requireJwtSocket.ts`** — Reads `handshake.auth.token`, verifies internal JWT, checks role matches namespace. Emits `AUTH_ERROR: forbidden namespace` and disconnects on mismatch.

**`attachReconnectSession.ts`** — Reads `handshake.auth.reconnect_token`. Fail-soft — never rejects connection. On failure, `socket.data.reconnectSession` is `undefined`.

### Events — `/candidate`

| Direction | Event | Notes |
|-----------|-------|-------|
| → server | `start_session` | Rate-limited **20/min**. Creates/resumes meeting; returns Agora token + meeting data |
| → server | `audio_chunk` | Raw PCM bytes → Deepgram. 200 KB/s limit. Gated by `socket.data.meetingStatus` cache |
| → server | `candidate_heartbeat` | 10s interval; updates `candidates.last_heartbeat` |
| → server | `add_note`, `update_note`, `delete_note` | Notes CRUD |
| → server | `share_video`, `video_play`, `video_pause`, `video_seek` | Video resume sync |
| → client | `session_established` | Reconnect token + meeting data |
| → client | `meeting_attached` | Meeting found via reconnect token |
| → client | `meeting_status` | Status change |
| → client | `transcript_segment` | Real-time Deepgram segment |
| → client | `session_replaced` | Another session opened → logout |

### Events — `/interviewer`

| Direction | Event | Notes |
|-----------|-------|-------|
| → server | `subscribe_open_rooms` | Join `open_rooms_monitor` room |
| → server | `join_open_meeting` | Join an open room; language pre-flight check |
| → server | `join_room` | Legacy reconnect path |
| → server | `end_meeting` | End meeting; triggers transcript flush |
| → server | `add_note`, `update_note`, `delete_note` | Notes CRUD |
| → server | `share_video`, `video_play`, `video_pause`, `video_seek` | Video sync |

### Events — `/supervisor`

| Direction | Event | Notes |
|-----------|-------|-------|
| → server | `subscribe_active_meetings` | Returns language-filtered active meetings; Redis cache 5s TTL |
| → server | `join_room` | Language pre-flight; `FORBIDDEN` on mismatch |

Supervisor Agora UIDs are prefixed `_sv_` (set in `namespaces/interviewer.ts`) and filtered from `remoteUsers` in `useAgora.js`. `socketId` fields are stripped from meeting data before broadcast.

### `BroadcastHelper` (`server/src/socket/broadcast.ts`)

Centralises all server→client emits.

**`openRoomsUpdate()`** (async):
1. Invalidates `openrooms:*` Redis keys
2. `fetchSockets()` with 3-second `Promise.race` timeout (guards against Redis adapter hang)
3. Per socket: reads `socket.data.user.language`, checks Redis cache `openrooms:{lang}` (5s TTL), fetches from DB on miss, emits `open_rooms_update`

**`meetingStatus()`**: Invalidates `activemeetings:*` Redis keys before emitting to meeting room and `meetings_monitor`.

---

## 10. HTTP API

### Auth (`/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/session` | None | Supabase token → internal JWT |
| POST | `/auth/refresh` | Expired JWT (1h grace) | Refresh internal JWT |
| GET | `/auth/me` | JWT | Current user payload |

### Meetings (`/meetings`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/meetings/:id` | JWT | Meeting detail |
| GET | `/meetings/:id/transcript` | JWT | Full transcript segments |
| GET | `/meetings/:id/notes` | JWT | Meeting notes |
| POST | `/meetings/:id/videos/upload-url` | JWT | Supabase Storage signed upload URL |
| GET | `/meetings/:id/videos` | JWT | List meeting videos |
| GET | `/meetings/:id/stream-url` | JWT | Signed stream URL |

### Candidates (`/candidates`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/candidates/:id/history` | JWT | Past meetings for candidate |

### Metrics (`/metrics`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/metrics` | JWT — **supervisor or admin role required** | `{ activeMeetings, queueDepth, scheduledJobs, deepgramSessions }` |

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | `{ status, version, nodeEnv, uptime }` — excluded from pino access logging |

---

## 11. Authentication

### Login

```
Client → POST /auth/session { supabase_token }
       → verifySupabaseToken() via supabaseAdmin.auth.getUser()
       → reads role + language from user_metadata
       → issueInternalJwt({ userId, email, role, orgId, language }, 15m TTL)
       → { token, user }
```

### Token refresh

```
Client → POST /auth/refresh { token: expiredJwt }
       → decodeExpiredJwt() (ignoreExpiration: true)
       → verify within 1h grace window
       → issue new JWT (15m TTL)
```

### Socket auth

`handshake.auth.token` → `requireJwtSocket.ts` → `verifyInternalJwt()` → role-to-namespace check.

### Reconnect tokens

256-bit base64url, stored in `sessions` table. `SessionService.findByToken()` uses `DELETE…RETURNING` for atomic single-use consumption. A fresh token is issued on each `session_established`.

---

## 12. Deepgram Transcription Pipeline

**Path**: candidate mic → `pcm-processor` AudioWorklet → Int16 PCM → `audio_chunk` Socket.IO event → `DeepgramManager` → Deepgram Nova-2 WebSocket → `TranscriptService.appendSegment()` → broadcast `transcript_segment` to all 3 namespaces + async batch DB write.

**Audio format**: linear16 PCM, 16 kHz, mono.

**`DeepgramManager`** (`server/src/lib/DeepgramManager.ts`):
- `MAX_RETRIES = 3`; exponential backoff 500ms / 1s / 2s
- `MAX_BUFFERED_AUDIO_BYTES = 160_000` — queues incoming audio during reconnect
- Gap segment inserted after reconnect to mark the interruption
- `onFatalError` callback → `BroadcastHelper.transcriptError(meetingId)`

**`TranscriptService`** (`server/src/domain/TranscriptService.ts`):
- `BATCH_SIZE = 20`, `FLUSH_INTERVAL_MS = 500`
- Segments buffered in `Map<meetingId, BufferedSegment[]>`
- `insertBatch()` uses PostgreSQL `unnest()` for a single round-trip batch insert
- `appendSegment()` triggers broadcast immediately; DB write is batched asynchronously
- `flush(meetingId?)` called at `endMeeting()` to drain remaining segments

---

## 13. Agora RTC

**Token generation** (`server/src/domain/AgoraTokenService.ts`):
- `deriveUid(meetingId, userId)`: SHA-256 → first 4 bytes → `>>> 1 | 1` → 31-bit positive int
- `generateToken()`: `RtcRole.PUBLISHER` for interviewer/candidate; `RtcRole.SUBSCRIBER` for supervisor

**Client hook** (`client/src/hooks/useAgora.js`):
- Supervisors skip track creation and publish
- Remote users: UIDs prefixed `_sv_` are filtered out of `remoteUsers`
- `AudioContext.resume()` on `visibilitychange` and `focus` events (mobile/tab sleep)
- `startTransition` wraps `setRemoteUsers` to avoid tearing
- `mountedRef` guards prevent state updates after unmount

Supervisor UID prefix `_sv_` is set in `namespaces/interviewer.ts`. Never change without updating both `AgoraTokenService.ts` and `useAgora.js`.

---

## 14. Client Architecture

### Routing (`App.jsx`)

```
/              → redirect based on role
/login         → LoginPage (public)
/register      → RegisterPage (public)
/join/:code    → CandidateJoinPage → CandidateWaitingRoom
/interviewer   → ProtectedRoute(role: interviewer) → InterviewerDashboard
/supervisor    → ProtectedRoute(role: supervisor) → SupervisorDashboard
/room/:id      → RoomGuard → InterviewRoom
```

`AppInit` gates rendering on `hydrated` from `useAuthStore`. Sync `rehydrate()` at module load; async `tryRefresh()` after.

### Zustand stores

**`useAuthStore`** — `user`, `token`, `hydrated`. `rehydrate()` is sync (sessionStorage). `tryRefresh()` is async. `userFromPayload()` reads `language` from JWT payload.

**`useMeetingStore`** — All meeting fields. `applyMeetingStatus()` handles transitions. `clearMeeting()` on end. Agora token intentionally **not** stored.

**`useTranscriptStore`** — `mergeCatchupData()` map-merge by ID + sort. `addSegment()` deduplicates by ID.

### Socket singletons (`useSocket.js`)

Module-level singleton socket instances per namespace. `reconnectStorage` and `attachedMeetingStorage` in sessionStorage. `session_established` stores new reconnect token. `session_replaced` → logout + `disconnectAll()`.

### InterviewRoom layout

```
┌──────────────────────────────────────────┐
│  Header (logo, meeting ID, status badge) │  ~56px fixed
├──────────────────────┬───────────────────┤
│  Video area          │  Sidebar           │
│  flex-[3]  (60%)     │  flex-[2]  (40%)  │
│  VideoGrid           │  Tab strip         │
│  ParticipantPanel    │  [T | N | V | H]   │
│                      │  PanelContent      │
├──────────────────────┴───────────────────┤
│  RoomControls (mic, camera, end call)    │  ~64px fixed
└──────────────────────────────────────────┘
```

Mobile (below `md`): stacked — video (aspect-video) → panel → combined controls+tabs bar at bottom.

Overlays:
- **Interrupted**: 30s countdown + reconnect prompt
- **Terminated**: 5s draining dot row → auto-redirect

---

## 15. Design System

### Color tokens (`client/tailwind.config.js`)

The primary palette was switched from indigo (#6366f1) to **teal** (#14b8a6) and surface from slate to **zinc** in the redesign. All existing `primary-*` and `surface-*` class references pick up the new values automatically — no JSX renaming required.

| Token | Value | Use |
|-------|-------|-----|
| `primary-400` | `#2dd4bf` (teal) | Icons, tab active border, dot-pulse |
| `primary-500` | `#14b8a6` (teal) | Primary interactive colour |
| `primary-600` | `#0d9488` (teal) | Button background (`btn-primary`) |
| `surface-950` | `#09090b` (zinc) | Page background |
| `surface-900` | `#18181b` (zinc) | Input backgrounds |
| `surface-800` | `#27272a` (zinc) | Card backgrounds |
| `surface-700` | `#3f3f46` (zinc) | Borders |
| `success-400` | `#34d399` (emerald) | Connected / active state |
| `danger-500` | `#f43f5e` (rose) | End call, errors |
| `warning-400` | `#fbbf24` (amber) | Interrupted / waiting states only |

### Component classes (`client/src/index.css`)

| Class | Description |
|-------|-------------|
| `.glass-card` | `bg-surface-800/60 border border-surface-700/50 rounded-lg` — **no** backdrop-blur |
| `.glass-card-hover` | `.glass-card` + hover border brightens; no glow shadow |
| `.glass-input` | `bg-surface-900/80 border rounded-md` — focus: `border-primary-500`; no blurred ring |
| `.btn-primary` | Flat teal `bg-primary-600` — **no gradient, no glow, no active:scale** |
| `.btn-secondary` | `bg-surface-800 border` — flat solid |
| `.btn-danger` | Flat rose `bg-danger-500` — no gradient |
| `.btn-icon` | 44px, `bg-surface-800/80 rounded-md` |
| `.status-badge` | `rounded text-xs font-medium` — `rounded` (2px) not `rounded-full` |
| `.video-tile-label` | **Keeps** `backdrop-blur-sm` — sits over live video where blur is real |
| `.dot-pulse` | Three-dot bounce using `primary-400` |
| `.room-code` | `font-mono text-4xl tracking-[0.3em] text-primary-400` |
| `.toast` variants | `animate-slide-in-right` fixed toasts |

**Font**: Geist loaded via `@fontsource/geist` npm package (weights 300–800; no CDN request). JetBrains Mono for mono elements.

**Tabular numbers**: `.font-mono` sets `font-feature-settings: "tnum" 1, "zero" 1` — timers and segment counts don't shift layout as digits change.

---

## 16. Design Decisions

### 1. Redis is optional; dual-mode scheduler

At boot, `waitForRedis(5000)` probes Redis. On failure, `disconnectRedis()` permanently closes the ioredis connection (stops log spam), and the system falls back to `MemoryScheduler` + Socket.IO in-memory adapter.

**Tradeoff**: Without Redis, `fetchSockets()` is local-only, rate limiter buckets are per-process, and timer state is lost on restart. Multi-instance deployments require Redis.

### 2. BullMQ for grace/claim timers

`BullScheduler` stores grace and claim timers in Redis with deterministic job IDs. A server crash during a grace window still fires the timer after restart.

**Tradeoff**: Crash-resilient timers depend on Redis. `MemoryScheduler` is safe for dev/staging — jobs lost on restart, settle scan partially compensates.

### 3. `recovery.ts` — minimal boot recovery

`recoverScheduledJobs()` **only** deletes expired sessions. It does not reconstruct timers — BullMQ persists those in Redis automatically.

**Tradeoff**: In `MemoryScheduler` mode, a crash drops all timer state. Settle scan mitigates for `active` meetings only.

### 4. Transcript batch insert via `unnest()`

`TranscriptService` buffers segments and flushes every 500ms or at 20 segments using a single `unnest()` batch insert. Broadcast fires immediately, independent of the DB write.

**Tradeoff**: Segments may be up to 500ms delayed in the DB (not the UI). A crash during flush loses up to 20 segments. Acceptable for interview transcription.

### 5. In-memory room registry

`server/src/state/roomRegistry.js` uses plain `Map`s. Durable state is the DB; in-flight state lives in socket `data`.

**Tradeoff**: Server restart destroys in-memory state. Settle scan + BullMQ grace timers handle active meetings; open/waiting rooms with no live sockets at restart are not auto-recovered.

### 6. Supervisor stealth via `_sv_` UID prefix

Supervisor Agora UIDs are prefixed `_sv_` server-side. `useAgora.js` filters them from `remoteUsers`. Candidates never see supervisors.

**Tradeoff**: Any refactor touching the prefix must update `AgoraTokenService.ts` and `useAgora.js` atomically.

### 7. Language separation at the query level

All room queries filter by `users.language` (migration 0005). Language flows: Supabase metadata → JWT payload → `socket.data.user.language` → every DB query and `join_room` pre-flight.

**Tradeoff**: Language is set at account creation and embedded in the JWT. Changing it requires re-login.

### 8. `start_session` rate limit: 20 per minute

In-process token bucket (`rateLimiter.ts`). Bucket is reset after a successful meeting end (`resetSocketRateLimit()`), so a legitimate reconnect isn't penalised.

**Tradeoff**: In-process buckets don't survive restarts and don't coordinate across instances. Acceptable for single-instance deployment.

### 9. No React StrictMode

StrictMode double-invokes effects in development. Agora RTC and Socket.IO effects are not idempotent — double-invocation joins the Agora channel twice and creates duplicate socket connections.

**Tradeoff**: StrictMode's impure-render detection is unavailable.

### 10. `openRoomsUpdate()` is async with per-language Redis cache

`fetchSockets()` is wrapped in a 3-second `Promise.race` timeout to guard against Redis adapter slowness. Results are cached per language (5s TTL) to amortise repeated DB queries when many interviewers are on the dashboard simultaneously.

**Tradeoff**: Up to 5 seconds of stale open room data per language. Acceptable — rooms are long-lived relative to the TTL.

---

## 17. Deployment

### Server — Railway

- Docker: `node:22-alpine`
- Start: `npm start` → `node --import tsx/esm src/server.ts` (`tsx` in production deps)
- Health check: `GET /health`, timeout 30s, `ON_FAILURE` restart, max 3 retries (`server/railway.json`)
- Env vars set in Railway dashboard; optional Redis via Railway Redis add-on (`REDIS_URL`)

### Client — Vercel

- Build: `npm run build:client` → `client/dist/`
- SPA rewrite: all paths → `/index.html` (`client/vercel.json`)
- Env vars: `VITE_*` prefix required

### Boot sequence

1. Zod validates env → exits on missing required vars
2. `checkDbConnection()` — DB ping
3. `waitForRedis(5000)` → probe; `disconnectRedis()` on failure
4. Construct domain services; wire `broadcastRef` lazy cycle-breaker
5. `BullScheduler` or `MemoryScheduler`; register handlers; `scheduler.start()`
6. `recoverScheduledJobs()` — delete expired sessions only
7. Mount HTTP routes + error handler
8. `createSocketServer()` — Redis adapter if available; register 3 namespaces
9. `startPresenceSweeper()`
10. `server.listen(env.PORT)`
11. After 10s: settle scan — any `active` meeting with no live sockets → `interrupted`

### Graceful shutdown (SIGTERM / SIGINT)

```
sweeper.stop()
scheduler.close()
deepgramManager.stopAll()
io.close()
  → pool.end()
    → process.exit(0)
10s hard timeout → process.exit(1)
```

---

## 18. Known Limitations

1. **Single-instance only without Redis** — `fetchSockets()`, rate limiter buckets, and `MemoryScheduler` timers are all in-process. Multi-instance requires Redis.

2. **No session persistence on restart** — In-memory state is lost. Settle scan + BullMQ handle active meetings; open/waiting rooms with no live sockets are not recovered.

3. **Language is immutable post-signup** — Embedded in JWT; change requires re-login and Supabase metadata update.

4. **Supabase env vars always required at startup** — `lib/supabase.ts` exits on any missing Supabase var, even for requests that never touch Supabase.

5. **`MemoryScheduler` timer loss on restart** — In Redis-absent mode, a crash during a grace window drops the timer. Settle scan runs once and cannot reconstruct remaining grace duration.

6. **No end-to-end encryption for transcript data** — Agora handles media encryption; transcript text is stored in plaintext in Supabase PostgreSQL.

7. **`ClaimService` is dead code in the primary flow** — Claim/queue flow is implemented but unused; the primary path is candidate-created open rooms (`status='open'`). Kept for legacy compatibility.
