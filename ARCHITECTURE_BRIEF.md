# RecruitMonitor v2 — Claude Code Implementation Brief (Postgres-only, no Redis)

> Paste **Section A (Master Context)** into Claude Code first as the project context.
> Then paste **one phase prompt at a time** from Section B. Wait for each to complete and verify before moving to the next.

---

## Section A — Master Context

### Project

RecruitMonitor is a realtime interview platform. We are migrating from a room-code-based ephemeral architecture to a **persistent, presence-driven orchestration platform**.

The existing codebase uses:
- Frontend: React + Vite + Zustand, Agora RTC SDK, Socket.IO client
- Backend: Node.js + Express, Socket.IO server, Deepgram, Supabase auth
- Deploy: Vercel (frontend), Railway (backend)

We are **keeping** all of the above. We are **adding** PostgreSQL (via Supabase) for persistent state and server-side Agora token generation. We are running on a **single Node instance**; the architecture is designed to make adding Redis or a second instance a clean swap later, not a rewrite.

### Roles

- **Candidate**: logs in, sits in a waiting room, gets matched by an interviewer.
- **Interviewer**: sees a queue of waiting candidates, claims one to start a meeting.
- **Supervisor**: silently observes active meetings, read-only.

### Locked architecture decisions (do not deviate)

1. **Transcript model**: append-only immutable AI transcript (Deepgram output) + separate editable notes layer. Notes anchor to segment IDs. Transcript segments are never updated or deleted.
2. **Meeting lifecycle**: persistent DB entity with explicit state machine. States: `WAITING`, `CLAIMED`, `CONNECTING`, `ACTIVE`, `INTERRUPTED`, `ENDED`, `CANCELLED`. Only valid transitions allowed; invalid transitions throw and log.
3. **Grace window**: 30 seconds. Disconnect → `INTERRUPTED`. Reconnect within 30s → `ACTIVE`. Otherwise → `ENDED`.
4. **Claim lock**: atomic Postgres UPDATE on `candidate_presence` with a 60s claim TTL stored as `claimed_at` timestamp. One interviewer can hold one candidate at a time. Conflicts return zero rows from the UPDATE.
5. **Auth**: Supabase issues identity. Backend exchanges Supabase JWT for an internal JWT (15min) with `userId`, `role`, `orgId`. Socket middleware validates internal JWT per namespace. Refresh via Supabase session.
6. **Agora**: server-side RTC token generation using `agora-token` package. Tokens are channel + uid + role scoped, 1h TTL, renewed before expiry. App ID is server-only on the backend; only the token is sent to clients. App Certificate stays server-only.
7. **Deepgram**: one long-lived WS per active meeting, owned by the backend. Buffers audio for 5s during reconnects. Logs gap segments if reconnect fails.
8. **Presence**: Postgres is both live source and durable store. Heartbeats every 10s update `candidate_presence.last_heartbeat_at`. An in-process sweeper marks stale rows offline every 30s. `PresenceService` is the only writer.
9. **Single Node instance**: no Socket.IO adapter, no pub/sub. PresenceService and MeetingService broadcast directly via the local `io` instance.
10. **Three socket namespaces**: `/candidate`, `/interviewer`, `/supervisor`. Each with its own auth middleware. No cross-namespace event handling.
11. **Validation**: every socket event payload validated with Zod schemas. Reject malformed events with structured error including request_id.
12. **Authorization**: single `canViewMeeting(user, meeting)` policy function. Every read of meeting/transcript/notes routes through it.
13. **Delayed work** (claim expiry, grace timer, token renewal): in-process `setTimeout` via a `JobScheduler` abstraction. Every scheduled job is also represented as a derivable timestamp in Postgres (e.g. `claimed_at + 60s`, `disconnected_at + 30s`), so on server boot a recovery scan resolves any jobs missed during downtime. **This is the most important reliability detail in the no-Redis design.**
14. **Abstraction layer**: PresenceService, ClaimService, JobScheduler, and the rate limiter all sit behind interfaces. Postgres/in-memory implementations now; Redis implementations can be swapped in later without touching callers.

### Tech stack (locked versions, install these exactly)

Backend:
- `express` ^4.19
- `socket.io` ^4.7
- `pg` ^8.12
- `zod` ^3.23
- `pino` ^9.3 + `pino-http`
- `jsonwebtoken` ^9.0
- `@deepgram/sdk` ^3.5
- `agora-token` ^2.0.4
- `helmet` ^7.1
- `express-rate-limit` ^7.4 (in-memory store, default)
- `uuid` ^10.0
- TypeScript

Frontend (additions to existing stack):
- `zod` ^3.23 (shared schemas)
- `agora-rtc-sdk-ng` (already present, keep)

Database: PostgreSQL via Supabase
Cache/queue: **none**. State is Postgres + in-process memory + setTimeout.

### File layout (backend)

```
/server
  /src
    /config         (env loading, validated with Zod)
    /db             (migrations, pg pool, query helpers, repositories)
    /auth           (Supabase exchange, internal JWT issue/verify)
    /services       (MeetingService, PresenceService, TranscriptService, ClaimService, AgoraTokenService)
    /scheduler      (JobScheduler - setTimeout + DB-backed recovery)
    /sockets        (namespace setup, middleware, handlers)
    /sockets/handlers   (one file per event group)
    /schemas        (Zod schemas for socket payloads and REST bodies)
    /policy         (canViewMeeting and other authorization)
    /deepgram       (DeepgramManager - per-meeting WS lifecycle)
    /http           (REST routes)
    /lib            (logger, errors, ids)
    /state          (MeetingStateMachine - pure functions)
    server.ts       (entry)
  /migrations       (.sql files, numbered)
  /tests
```

### Coding standards

- TypeScript strict mode on.
- No `any` except at well-documented external boundaries.
- All async errors propagate through `next(err)` (HTTP) or get caught and emitted as structured socket errors. Never let a promise reject silently.
- Every socket handler wraps logic in try/catch and logs with `request_id`.
- Service methods are the only place that mutate DB rows for their domain. Handlers call services, services call repositories, repositories call pg.
- State machine transitions are pure functions in `/state` that take `(currentState, event) → newState | InvalidTransition`. The service applies them and persists.
- No business logic in socket handlers beyond payload parsing and service delegation.
- Structured logs only (`logger.info({ request_id, meeting_id, ... }, 'message')`). No `console.log`.
- Every `setTimeout` for domain logic goes through `JobScheduler`. Never call `setTimeout` directly in services. This is what makes server restart safe.

### Environment variables (backend)

```
NODE_ENV
PORT
DATABASE_URL                  (Supabase Postgres connection string)
JWT_SECRET                    (for internal JWT)
JWT_EXPIRES_IN=15m
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
AGORA_APP_ID
AGORA_APP_CERTIFICATE         (required for server tokens)
AGORA_TOKEN_TTL_SECONDS=3600
DEEPGRAM_API_KEY
CLIENT_ORIGIN                 (comma-separated list)
GRACE_WINDOW_SECONDS=30
CLAIM_TTL_SECONDS=60
PRESENCE_HEARTBEAT_INTERVAL_SECONDS=10
PRESENCE_STALE_AFTER_SECONDS=30
PRESENCE_SWEEPER_INTERVAL_SECONDS=15
LOG_LEVEL=info
```

Validate all of these on boot with Zod. Crash with a clear error if anything is missing.

### Important: start by surveying

Before writing code, **read the existing repo structure and report back** what's there. Don't assume. Map current files to the new layout. Flag anything you'd remove, keep, or refactor. Wait for my confirmation before destructive changes.

---

## Section B — Phase Prompts

### Phase 0 — Survey and scaffold

```
Survey the existing repo. List the current file structure of both frontend and backend.
For each existing file, classify it as: KEEP_AS_IS, REFACTOR, DELETE, or UNCERTAIN.
Then propose the new backend file layout under /server/src per the master context.
Do not write any code yet. Output a markdown report.
```

### Phase 1 — Backend scaffold + config + logging

```
Set up the backend skeleton per the master context file layout. Specifically:
1. Initialize TypeScript with strict mode, tsconfig, eslint, prettier.
2. Install all locked backend dependencies (no Redis, no BullMQ — Postgres only).
3. Create /src/config/env.ts that loads and Zod-validates all environment variables.
4. Create /src/lib/logger.ts (Pino) with request_id support.
5. Create /src/lib/errors.ts with typed error classes: DomainError, AuthError, ValidationError, NotFoundError, ConflictError, InvalidTransitionError.
6. Create /src/lib/ids.ts (uuid wrapper).
7. Create a minimal /src/server.ts that boots Express, mounts Helmet, mounts pino-http, exposes GET /health that returns 200 with build info.
8. Add npm scripts: dev, build, start, lint, typecheck.
Do not add DB, sockets, or business logic yet. Just the skeleton. Verify `npm run dev` boots and /health responds.
```

### Phase 2 — Database schema + migrations + pg pool

```
Create the database layer:
1. Create /migrations/0001_init.sql with these tables, indexes, and constraints:
   - users (id uuid pk, email unique, role enum, name, org_id uuid, created_at)
   - candidate_presence (
       user_id pk fk users,
       status enum,
       socket_id,
       last_heartbeat_at timestamptz,
       claimed_by fk users null,
       claimed_at timestamptz null,
       current_meeting_id fk meetings null,
       updated_at timestamptz
     )
   - meetings (id uuid pk, candidate_id fk users, interviewer_id fk users, status enum, agora_channel unique, created_at, started_at, ended_at, end_reason enum null)
   - meeting_participants (
       meeting_id fk,
       user_id fk,
       role enum,
       agora_uid int,
       joined_at,
       left_at null,
       disconnected_at null,
       pk(meeting_id, user_id)
     )
   - sessions (
       id uuid pk,
       user_id fk users,
       reconnect_token unique,
       expires_at timestamptz,
       created_at timestamptz
     )
   - transcript_segments (
       id uuid pk,
       meeting_id fk,
       seq int,
       speaker_user_id fk null,
       speaker_role enum,
       text,
       started_at,
       ended_at,
       is_final bool,
       confidence float,
       created_at;
       unique(meeting_id, seq)
     )
   - transcript_notes (
       id uuid pk,
       meeting_id fk,
       anchor_segment_id fk null,
       author_user_id fk,
       body,
       created_at,
       updated_at
     )

2. Create enums: user_role, candidate_status (offline|waiting|claimed|in_meeting|disconnected), meeting_status (waiting|claimed|connecting|active|interrupted|ended|cancelled), end_reason, participant_role, speaker_role.

3. Add the partial unique index:
   CREATE UNIQUE INDEX one_active_meeting_per_candidate
   ON meetings(candidate_id)
   WHERE status IN ('claimed','connecting','active','interrupted');

4. Performance indexes:
   - meetings(status, candidate_id)
   - meetings(interviewer_id, status)
   - transcript_segments(meeting_id, seq)
   - candidate_presence(status, last_heartbeat_at)  -- supports both queue queries and the stale sweeper
   - sessions(expires_at) -- for cleanup
   - sessions(user_id)

5. Create /src/db/pool.ts (pg Pool with sane defaults: max 20, idleTimeoutMillis 30000, connectionTimeoutMillis 5000).

6. Create /src/db/migrate.ts (simple migration runner that reads /migrations/*.sql in order and tracks applied migrations in a schema_migrations table).

7. Add npm script: migrate.

8. Document how to run migrations against Supabase Postgres in /server/README.md, including which connection string to use (direct, not pooled, for migrations).

Verify migrations run cleanly on a fresh DB.
```

### Phase 3 — JobScheduler + presence sweeper (replaces the Redis phase)

```
Implement the in-process scheduling layer that makes server-restart safe without Redis.

1. /src/scheduler/JobScheduler.ts — a class with these methods:
   - schedule(jobId: string, runAt: Date, handler: () => Promise<void>): registers a setTimeout. If jobId already exists, replace it.
   - cancel(jobId: string): clears the timeout.
   - has(jobId: string): boolean.
   The scheduler keeps an in-memory Map<jobId, NodeJS.Timeout>. It does NOT persist anything itself — persistence comes from the DB columns that derive the runAt (claimed_at + ttl, disconnected_at + grace, etc.).

2. /src/scheduler/recovery.ts — exports recoverScheduledJobs(deps) called once on boot. It runs these queries and reschedules:
   - SELECT meetings WHERE status='claimed' → for each, schedule claim expiry at claimed_at + CLAIM_TTL_SECONDS. If already past, run immediately.
   - SELECT meetings WHERE status='interrupted' → for each, find latest disconnected_at among participants, schedule grace expiry at disconnected_at + GRACE_WINDOW_SECONDS. If past, run immediately.
   - SELECT sessions WHERE expires_at < now() → delete in batch.
   Recovery runs BEFORE the HTTP server starts accepting connections.

3. /src/scheduler/sweeper.ts — exports startPresenceSweeper(deps). Runs every PRESENCE_SWEEPER_INTERVAL_SECONDS:
   - UPDATE candidate_presence SET status='offline' WHERE status IN ('waiting','disconnected') AND last_heartbeat_at < now() - interval 'PRESENCE_STALE_AFTER_SECONDS seconds' RETURNING user_id.
   - For each returned user_id, broadcast a presence delta (do this via the broadcast callback injected at startup — sweeper does not import sockets directly).
   - DELETE expired sessions in the same tick.
   Returns a stop() function for graceful shutdown.

4. /src/server.ts boot sequence:
   - Validate env
   - Connect pg
   - Run recoverScheduledJobs
   - Start presence sweeper
   - Start HTTP + sockets
   - Register graceful shutdown handlers

5. Unit tests:
   - JobScheduler: schedule + cancel + replace.
   - recovery: insert a CLAIMED meeting with claimed_at = now - 2 minutes, run recovery, assert it gets cancelled immediately.
   - sweeper: insert a presence row with last_heartbeat_at = now - 60s, run sweeper, assert status becomes offline.
```

### Phase 4 — Auth: Supabase exchange + internal JWT + middleware

```
1. Create /src/auth/supabase.ts that verifies a Supabase JWT (using SUPABASE_SERVICE_ROLE_KEY or jwks) and returns the user.
2. Create /src/auth/jwt.ts with issueInternalJwt(payload) and verifyInternalJwt(token). Payload includes userId, email, role, orgId. Exp from env.
3. Create POST /auth/session: accepts Supabase JWT in Authorization header, validates, upserts user into users table, returns internal JWT + user profile.
4. Create POST /auth/refresh: accepts current internal JWT (even if recently expired within a small grace), re-validates the underlying Supabase session, issues new internal JWT.
5. Create Express middleware /src/http/middleware/requireAuth.ts that validates internal JWT and attaches req.user.
6. Add unit tests for jwt issue/verify and middleware happy/sad paths.
Do not wire socket auth yet (Phase 6).
```

### Phase 5 — State machine + services + repositories

```
Implement the core domain layer with no socket or HTTP dependencies. Pure logic + DB + scheduler.

1. /src/state/meetingStateMachine.ts: pure function transition(currentState, event) returning newState or throwing InvalidTransitionError. Events: CLAIM, CANDIDATE_READY, CLAIM_EXPIRED, PARTICIPANT_JOINED, PARTICIPANT_DISCONNECTED, RECONNECT_SUCCESS, GRACE_EXPIRED, INTENTIONAL_LEAVE, END_MEETING.

2. /src/db/repositories/ for each table: meetingsRepo, presenceRepo, transcriptRepo, notesRepo, usersRepo, sessionsRepo. Each repo exposes typed methods, no business logic.

3. /src/services/ClaimService.ts:
   - claimCandidate(interviewerId, candidateId):
       UPDATE candidate_presence
       SET status='claimed', claimed_by=$1, claimed_at=now(), updated_at=now()
       WHERE user_id=$2 AND status='waiting' AND claimed_by IS NULL
       RETURNING *;
     If zero rows: throw ConflictError. If success: create meetings row in CLAIMED status. Schedule claim expiry via JobScheduler at +CLAIM_TTL_SECONDS.
   - releaseClaim(meetingId, reason): rolls back presence + meeting. Cancels scheduled expiry.
   - onClaimExpired(meetingId): called by JobScheduler. If meeting still CLAIMED → transition to CANCELLED, restore candidate to WAITING.

4. /src/services/MeetingService.ts:
   - createMeeting, startMeeting, markParticipantJoined.
   - markParticipantDisconnected: sets disconnected_at, transitions ACTIVE→INTERRUPTED if not already, schedules grace expiry via JobScheduler.
   - reconnectParticipant: clears disconnected_at, cancels grace job, transitions INTERRUPTED→ACTIVE.
   - endMeeting(reason): final state, cancels all scheduled jobs for this meeting, tears down Deepgram (deferred to Phase 9).
   - onGraceExpired(meetingId): called by JobScheduler. If still INTERRUPTED → endMeeting('grace_expired').
   - Every state mutation calls the state machine first.

5. /src/services/PresenceService.ts:
   - setOnline(userId, socketId), heartbeat(userId), setOffline(userId), setInMeeting(userId, meetingId), setWaiting(userId).
   - Each method takes a broadcast callback (or uses an injected broadcaster) to emit deltas to interviewer dashboards. No pub/sub — direct in-process broadcast.

6. /src/services/TranscriptService.ts:
   - appendSegment(meetingId, ...): server assigns seq via SELECT COALESCE(MAX(seq),0)+1 in a transaction, or via a per-meeting in-memory counter that's hydrated on first use. Prefer the in-memory counter for performance, but seed it from DB on cold start.
   - listSegments(meetingId, sinceSeq?), addNote, updateNote, deleteNote, listNotes.

7. /src/services/AgoraTokenService.ts: issueToken(channel, uid, role, ttl) using agora-token. Role maps: PUBLISHER for candidate/interviewer, SUBSCRIBER for supervisor.

8. /src/policy/canViewMeeting.ts: single function (user, meeting) → boolean.

Unit tests:
- State machine: every valid + every invalid transition.
- ClaimService concurrency: simulate two interviewers claiming the same candidate via Promise.all. Exactly one must succeed.
- ClaimService expiry: claim, advance time, fire expiry handler, assert CANCELLED.
- MeetingService grace: disconnect, fire grace handler, assert ENDED with end_reason='grace_expired'.
- canViewMeeting matrix.
```

### Phase 6 — Socket layer: namespaces + middleware + Zod schemas

```
1. /src/schemas/socket.ts: Zod schemas for every socket event payload, organized by namespace.
2. /src/sockets/middleware/socketAuth.ts: verifies internal JWT from handshake auth, attaches user, enforces role-namespace match.
3. /src/sockets/middleware/rateLimit.ts: per-event in-memory rate limiting using a simple token bucket per (userId, eventName). Document that this is per-instance and will need replacement if we ever go multi-instance.
4. /src/sockets/middleware/validate.ts: wraps handlers with Zod parse on payload, emits structured error on failure with request_id.
5. /src/sockets/index.ts: initializes Socket.IO server, mounts three namespaces (/candidate, /interviewer, /supervisor), wires middlewares. No Redis adapter — single instance only.
6. /src/sockets/broadcast.ts: helper that exposes typed broadcast methods (toMeetingRoom, toInterviewerDashboard, toUserSocket). All services use this rather than touching `io` directly. This is the seam that will later swap to a Redis-aware broadcaster.
7. /src/sockets/handlers/ — empty handler skeletons that just log.
8. Add a "connection storm" test: 100 sockets connect, authenticate, disconnect. Verify no memory leaks and clean teardown.

Do NOT implement event handlers yet. Just verify auth works and rejected sockets fail cleanly.
```

### Phase 7 — Claim/matchmaking flow end-to-end

```
Implement the candidate-to-meeting handshake.

Backend:
1. /interviewer namespace handlers:
   - 'subscribe_queue': sends current waiting candidates (SELECT from candidate_presence WHERE status='waiting' ORDER BY updated_at ASC). The interviewer's socket joins a 'queue' room so PresenceService deltas reach them.
   - 'claim_candidate' { candidateId }: calls ClaimService.claimCandidate. On success, emits 'meeting_claimed' to candidate's socket and 'claim_success' to interviewer with meeting metadata + Agora token. On ConflictError, emits 'claim_failed' with reason.

2. /candidate namespace handlers:
   - On socket connect (in connection handler): PresenceService.setWaiting + start heartbeat tracking.
   - 'candidate_ready' after receiving 'meeting_claimed': MeetingService transitions CLAIMED → CONNECTING, emits 'meeting_starting' with Agora token to both parties.

3. Claim expiry: handled by JobScheduler from Phase 5. When fired, calls ClaimService.onClaimExpired, which transitions to CANCELLED, restores candidate to WAITING, broadcasts queue update.

Frontend:
1. Interviewer dashboard: subscribes to queue, renders waiting candidates with name + joined-at. Click triggers claim_candidate.
2. Candidate waiting room: shows "waiting for interviewer..." until 'meeting_claimed', then "connecting...", then transitions to meeting UI on 'meeting_starting'.

Test:
- Two interviewers, one candidate, simultaneous claim → exactly one succeeds.
- Interviewer claims, never sends candidate_ready → after 60s, candidate is back in waiting room.
- Restart server with a CLAIMED meeting in DB whose claimed_at is 70s ago → recovery cancels it on boot.
```

### Phase 8 — Agora server tokens + meeting room UI

```
Backend:
1. AgoraTokenService is already implemented (Phase 5); verify it's wired into the claim flow.
2. Add 'renew_agora_token' socket event for /candidate, /interviewer, /supervisor. Re-issues token if user is a participant (or authorized observer) of an ACTIVE/INTERRUPTED meeting.
3. Schedule per-meeting token renewal via JobScheduler at +(AGORA_TOKEN_TTL_SECONDS - 300). Pushes renewed token to participants. On meeting end, cancel the renewal job.

Frontend:
1. Remove any client-side Agora App ID usage. Tokens come only from the server.
2. Implement Agora client.renewToken() on receiving 'agora_token_renewed'.
3. Build the meeting room component: Agora join with token, publish local audio/video for candidate+interviewer (subscribe-only for supervisor), audio level indicators, mute/unmute.
4. On mute/unmute: explicitly call AudioContext.resume() if suspended. Also on visibilitychange→visible and window focus. This fixes the old bug — make it bulletproof and add a unit test for the resume logic.
5. Track 'mounted' state with useRef for all async Agora calls; if unmounted before track creation resolves, close the track immediately.

Test: start meeting, mute, unmute, verify audio flows. Refresh page (grace logic comes in Phase 11; for now just verify Agora rejoin works).
```

### Phase 9 — Deepgram pipeline + transcript persistence

```
Backend:
1. /src/deepgram/DeepgramManager.ts: a class that owns one Deepgram WS per meeting_id. Methods: start(meetingId), pushAudio(meetingId, chunk, speakerUserId), stop(meetingId). Internal Map<meetingId, DeepgramSession>.
2. On Deepgram WS disconnect: buffer incoming audio chunks for up to 5s, attempt reconnect with exponential backoff (max 3 attempts). On success, flush buffer. On failure, append a segment with text='[transcript unavailable]', log warning, continue meeting.
3. On 'final' transcript: TranscriptService.appendSegment with server-assigned seq. Broadcast 'transcript_segment' via the broadcast helper.
4. On 'interim': broadcast 'transcript_interim' to clients only, do NOT persist.
5. /candidate handler 'audio_chunk' { chunk }: forwards to DeepgramManager.pushAudio. Rate limited by bytes/sec via in-memory token bucket.
6. Wire MeetingService.endMeeting to call DeepgramManager.stop.

Frontend:
1. Candidate: extract PCM from Agora track, send via 'audio_chunk' socket event. Backpressure: if outbound buffer >2s of audio, drop oldest chunks.
2. All roles: subscribe to 'transcript_segment' and 'transcript_interim'. Finals in solid text, interims muted/italic. On final arrival at a given seq, replace the interim.
3. On reconnect (Phase 11): GET /meetings/:id/transcript?since_seq=N to backfill.

Speaker attribution from the server-known sender, not Deepgram diarization.

Test: full meeting with two speakers, transcript persists, segments sequenced correctly, kill Deepgram mid-meeting and verify graceful gap.
```

### Phase 10 — Notes layer + supervisor view

```
Backend:
1. REST endpoints (all gated by canViewMeeting):
   - GET /meetings/:id
   - GET /meetings/:id/transcript?since_seq=
   - GET /meetings/:id/notes
   - POST /meetings/:id/notes { anchor_segment_id?, body }
   - PATCH /notes/:id { body }
   - DELETE /notes/:id
2. Socket events broadcast to meeting room: 'note_added', 'note_updated', 'note_deleted'.
3. /supervisor handlers:
   - 'subscribe_active_meetings': SELECT meetings WHERE status IN ('active','interrupted'). Joins a 'supervisor_dashboard' room; MeetingService broadcasts meeting lifecycle deltas there.
   - 'observe_meeting' { meetingId }: canViewMeeting check, joins the meeting's Socket.IO room (read-only), receives transcript + notes + Agora subscriber token.

Frontend:
1. Interviewer + candidate: notes sidebar. Click transcript segment → note anchored to it. Free-floating notes too.
2. Supervisor: active meetings list, click to observe. Sees transcript, notes, video as subscriber. No write events accepted by server even if attempted.

Test: notes from interviewer appear on candidate side live. Supervisor sees both transcripts and notes but cannot edit (verify both UI and server-side rejection).
```

### Phase 11 — Presence, heartbeat, reconnect tokens, grace window

```
This is the most critical reliability work. Do it carefully.

Backend:
1. On socket connect (any namespace):
   - PresenceService records online state.
   - sessionsRepo.create({ user_id, reconnect_token: uuid, expires_at: now + 60s }). Emit 'session_established' { reconnect_token } to client.

2. Heartbeat: client emits 'heartbeat' every 10s. Server updates candidate_presence.last_heartbeat_at. Rate limited at 1/8s.

3. On socket disconnect:
   - Inspect Socket.IO disconnect reason. 'client namespace disconnect' or 'server namespace disconnect' = intentional. Others ('transport close', 'ping timeout', 'transport error') = network.
   - Look up user's current meeting via candidate_presence.current_meeting_id.
   - If meeting in ACTIVE: MeetingService.markParticipantDisconnected → INTERRUPTED → JobScheduler.schedule(`grace:{meetingId}:{userId}`, now + GRACE_WINDOW_SECONDS, onGraceExpired).
   - If 'leave_meeting' event was received first: skip grace, transition straight to ENDED.

4. On reconnect with valid reconnect_token (passed in socket handshake auth):
   - sessionsRepo.findByToken, check not expired.
   - PresenceService restores state.
   - If user has a meeting in INTERRUPTED: MeetingService.reconnectParticipant → cancel grace job → ACTIVE → broadcast 'meeting_resumed'.
   - Issue a NEW reconnect_token (one-shot tokens; old token deleted).

5. Grace expiry handler (registered with JobScheduler):
   - If meeting still INTERRUPTED at fire time: MeetingService.endMeeting('grace_expired') → Deepgram stop → broadcast 'meeting_ended' to remaining participants → release candidate to WAITING.

6. Multi-tab: on new socket connect for a user who already has an active socket on the same namespace, emit 'session_replaced' to old socket and close it. Reconnect token is per-session.

7. Server restart safety: the JobScheduler recovery (Phase 3) handles in-flight grace timers because INTERRUPTED meetings carry disconnected_at. Verify with a restart test.

Frontend:
1. On socket disconnect: do NOT tear down meeting UI immediately. Show "reconnecting..." overlay with 30s countdown.
2. Socket.IO auto-reconnect with auth: { token: internalJwt, reconnect_token }.
3. On successful reconnect: hide overlay, GET /meetings/:id/transcript?since_seq=N for backfill, resume.
4. On grace expiry ('meeting_ended'): show final state, navigate candidate back to waiting room.
5. On 'session_replaced': show "connected from another window" message, stop reconnecting.
6. Explicit leave button → emit 'leave_meeting' before disconnect. beforeunload handler attempts the same as a backup.

Test matrix:
- Refresh candidate mid-meeting → grace → reconnect → resume.
- Kill candidate network for 20s → grace → reconnect → resume.
- Kill candidate network for 40s → grace expires → ENDED, candidate back in waiting room.
- Candidate clicks leave → immediate ENDED.
- Both disconnect simultaneously → both grace timers run → ENDED on last expiry.
- Interviewer disconnects, candidate stays → INTERRUPTED → interviewer reconnects → ACTIVE.
- Open second tab as same candidate → first tab gets session_replaced.
- Restart server mid-meeting: meeting in ACTIVE → boot recovery marks it INTERRUPTED and schedules grace based on now() (since we don't know exactly when participants will reconnect, this is acceptable; document the behavior).
- Actually for the previous bullet, refine: on boot, find ACTIVE meetings with no live socket presence after a 10s settle window, then transition to INTERRUPTED with disconnected_at=now(). Implement this explicitly.
```

### Phase 12 — Restart resilience, rate limiting, observability, deployment

```
1. Graceful shutdown (SIGTERM):
   - Stop accepting new HTTP and socket connections.
   - Emit 'server_restarting' to all meeting rooms with 15s warning.
   - Drain in-flight handlers (await a small grace period).
   - Cancel all JobScheduler timeouts (state is recoverable from DB anyway).
   - Close all Deepgram WSs cleanly.
   - Stop presence sweeper.
   - Close pg pool.
   - Exit 0.

2. Boot-time settle:
   - After recoverScheduledJobs, wait 10s for clients to reconnect (server is up but holding off on aggressive state transitions).
   - After settle: any meeting in ACTIVE with no live participant socket → transition to INTERRUPTED with disconnected_at=now() and schedule grace.

3. Rate limiting:
   - /auth/*: 20 req/min per IP (express-rate-limit, in-memory).
   - claim_candidate: 5/min per interviewer (in-memory token bucket).
   - audio_chunk: 200 KB/sec per candidate (byte-based, in-memory).
   - heartbeat: 1/8s per socket.
   - note CRUD: 30/min per user.
   Document explicitly that all of these are per-instance. Fine for single instance; needs Redis-backed replacement if scaled.

4. Observability:
   - request_id flows from HTTP → service → socket emissions.
   - Structured logs for every meeting state transition: { event: 'meeting_transition', meeting_id, from, to, reason, duration_ms }.
   - /metrics endpoint (simple JSON or Prometheus format) exposing: active_meetings_count, queue_depth, claim_conflicts_total, deepgram_reconnects_total, transcript_segment_latency_p95, scheduled_jobs_count, presence_sweeper_evictions_total.
   - /health: deep health check (pg reachability + Deepgram reachability via a cheap probe).

5. Deployment configs:
   - /server/Dockerfile (multi-stage build).
   - /server/railway.json with healthcheck path /health and a single replica (NOT multiple — the architecture currently assumes one instance).
   - Update frontend Vercel env to point at new backend.
   - Document the full env var matrix in /server/README.md.
   - Document explicitly in README.md: "This deployment runs as a single instance. Scaling to multiple instances requires (a) a Socket.IO adapter — Redis or Postgres-based — and (b) replacing in-memory rate limiters and the JobScheduler's in-memory map with a shared store. The service interfaces are designed to accommodate this."

6. Final integration test script: spins up 100 concurrent candidate sockets + 10 interviewer sockets, runs through claim/start/transcript/end for 50 meetings, asserts no errors and correct final DB state. Run this against a staging environment before declaring done.

After this phase, the system is production-ready for ~100 concurrent users on a single instance.
```

---

## Notes for Claude Code

- After each phase, run typecheck + lint + tests before declaring done.
- If a phase reveals an ambiguity not covered in the master context, **stop and ask** rather than guessing.
- Commit after each phase with a clear message: `phase N: <summary>`.
- If you discover that an architectural decision in the master context conflicts with reality in the existing code, **surface it** rather than silently working around it.
- The single most important invariant: **every delayed action must be derivable from a DB timestamp**, so that JobScheduler recovery on boot can reconstruct all in-flight work. If you ever need a timer whose state lives only in memory, stop and reconsider the design.