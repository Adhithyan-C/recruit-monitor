# RecruitMonitor — Architecture Document

---

## 1. System Overview

RecruitMonitor is a real-time interview monitoring platform that connects three roles over live video: **candidates** join a waiting room and are automatically transcribed by Deepgram Nova-2 while speaking; **interviewers** browse a language-filtered queue of waiting candidates and join their solo room to conduct the interview; **supervisors** silently monitor any active interview in stealth mode (subscriber-only Agora token, presence hidden from other participants). Every spoken word from the candidate is transcribed server-side and broadcast to all participants in real time. Interviewers can annotate the transcript with timestamped notes, and both parties can share or record video resumes that play back in synchronized lockstep.

---

## 2. Tech Stack

### Server (`server/`)

| Library | Version | Role |
|---|---|---|
| Node.js | ≥22 | Runtime |
| TypeScript | ^5.5 | Language (strict, NodeNext modules) |
| Express | ^4.19 | HTTP server + REST API |
| Socket.IO | ^4.7 | WebSocket server — three namespaces |
| `pg` (node-postgres) | ^8.12 | PostgreSQL client, connection pool (max 20) |
| Supabase JS (`@supabase/supabase-js`) | ^2.45 | Auth token verification, Storage signed URLs |
| `jsonwebtoken` | ^9.0 | Internal JWT issue + verify (HS256, 15-min TTL) |
| `@deepgram/sdk` | ^3.5 | Live transcription WebSocket client |
| `agora-token` | ^2.0.4 | RTC token generation (CJS, loaded via `createRequire`) |
| Zod | ^3.23 | Env validation at boot; socket payload validation |
| Pino + pino-http | ^9.3 / ^10 | Structured JSON logging |
| Helmet | ^7.1 | HTTP security headers |
| express-rate-limit | ^7.4 | HTTP-level rate limiting on `/auth` |
| `uuid` | ^10 | UUIDs for all IDs (`newId()` = `uuidv4()`) |
| tsx | ^4.16 | TypeScript execution in dev mode |

### Client (`client/`)

| Library | Version | Role |
|---|---|---|
| React | ^19.2 | UI framework (no StrictMode — intentional) |
| React Router DOM | ^7.15 | SPA routing, `ProtectedRoute` + `RoomGuard` |
| Vite | ^8.0 | Build tool + dev server |
| Tailwind CSS | ^3.4 | Styling (custom `primary`/`surface`/`success`/`danger`/`warning` palette) |
| Zustand | ^5.0 | Client state — three stores |
| Socket.IO Client | ^4.8 | WebSocket client, module-level singletons |
| agora-rtc-sdk-ng | ^4.24 | Agora RTC browser SDK |
| `@supabase/supabase-js` | ^2.106 | Supabase auth (signUp, signInWithPassword) |
| Geist / JetBrains Mono | via fontsource | Typography |

---

## 3. Database Schema

PostgreSQL hosted on Supabase. Migrations applied via `server/src/db/migrate.ts` (sequential `.sql` files in `server/migrations/`, tracked in `schema_migrations`).

### Tables

#### `users`
| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK — mirrors Supabase `auth.users.id` |
| `email` | TEXT | NOT NULL, UNIQUE |
| `role` | `user_role` enum | NOT NULL — `candidate`, `interviewer`, `supervisor` |
| `name` | TEXT | NOT NULL |
| `org_id` | UUID | nullable |
| `created_at` | TIMESTAMPTZ | DEFAULT now() |
| `language` | TEXT | NOT NULL, DEFAULT `'english'`, CHECK IN (`english`,`tamil`,`hindi`) — migration 0005 |

#### `meetings`
| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK DEFAULT gen_random_uuid() |
| `candidate_id` | UUID | NOT NULL, FK → users |
| `interviewer_id` | UUID | nullable (NULL until interviewer joins) — migration 0003 |
| `status` | `meeting_status` enum | NOT NULL, DEFAULT `waiting` |
| `agora_channel` | TEXT | NOT NULL, UNIQUE |
| `created_at` | TIMESTAMPTZ | NOT NULL |
| `started_at` | TIMESTAMPTZ | nullable — set when status → active |
| `ended_at` | TIMESTAMPTZ | nullable |
| `end_reason` | `end_reason` enum | nullable |

**`meeting_status` values:**
- `open` — candidate created solo room; no interviewer yet (primary flow)
- `waiting` — legacy queue state
- `claimed` — legacy: interviewer reserved candidate
- `connecting` — legacy: both sides initializing Agora
- `active` — both peers live in Agora channel
- `interrupted` — one participant disconnected; 30-second grace window
- `ended` — terminal: meeting concluded
- `cancelled` — terminal: cancelled before active

#### `candidate_presence`
| Column | Type | Constraints |
|---|---|---|
| `user_id` | UUID | PK, FK → users ON DELETE CASCADE |
| `status` | `candidate_status` enum | NOT NULL, DEFAULT `offline` |
| `socket_id` | TEXT | nullable |
| `last_heartbeat_at` | TIMESTAMPTZ | nullable |
| `claimed_by` | UUID | nullable, FK → users |
| `claimed_at` | TIMESTAMPTZ | nullable |
| `current_meeting_id` | UUID | nullable, FK → meetings |
| `updated_at` | TIMESTAMPTZ | NOT NULL |

#### `meeting_participants`
| Column | Type | Constraints |
|---|---|---|
| `meeting_id` | UUID | PK composite, FK → meetings ON DELETE CASCADE |
| `user_id` | UUID | PK composite, FK → users |
| `role` | `participant_role` enum | NOT NULL |
| `agora_uid` | INTEGER | NOT NULL |
| `joined_at` | TIMESTAMPTZ | DEFAULT now() |
| `left_at` | TIMESTAMPTZ | nullable |
| `disconnected_at` | TIMESTAMPTZ | nullable — used by recovery.ts to reconstruct grace timers |

#### `sessions`
| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK → users ON DELETE CASCADE |
| `reconnect_token` | TEXT | UNIQUE — 256-bit URL-safe base64 |
| `expires_at` | TIMESTAMPTZ | NOT NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL |

#### `transcript_segments`
| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `meeting_id` | UUID | FK → meetings ON DELETE CASCADE |
| `seq` | INTEGER | NOT NULL, UNIQUE (meeting_id, seq) |
| `speaker_user_id` | UUID | nullable (null for system/gap segments) |
| `speaker_role` | `speaker_role` enum | NOT NULL — `candidate`, `interviewer`, `system` |
| `text` | TEXT | NOT NULL |
| `started_at` / `ended_at` | TIMESTAMPTZ | NOT NULL |
| `is_final` | BOOLEAN | NOT NULL, DEFAULT false |
| `confidence` | FLOAT | nullable |
| `created_at` | TIMESTAMPTZ | NOT NULL |

#### `transcript_notes`
| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `meeting_id` | UUID | FK → meetings |
| `anchor_segment_id` | UUID | nullable, FK → transcript_segments |
| `author_user_id` | UUID | NOT NULL, FK → users |
| `body` | TEXT | NOT NULL |
| `created_at` / `updated_at` | TIMESTAMPTZ | NOT NULL |

#### `meeting_videos`
| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `meeting_id` | UUID | FK → meetings ON DELETE CASCADE |
| `candidate_id` / `interviewer_id` | UUID | FKs → users |
| `candidate_name` / `interviewer_name` | TEXT | denormalized display names |
| `storage_path` | TEXT | NOT NULL — Supabase Storage key: `{meetingId}/{uuid}-{filename}` |
| `type` | TEXT | CHECK IN (`candidate_upload`, `interviewer_recording`) |
| `meeting_date` / `created_at` | TIMESTAMPTZ | NOT NULL |

### Indexes
```
UNIQUE one_active_meeting_per_candidate ON meetings(candidate_id)
  WHERE status IN ('open','claimed','connecting','active','interrupted')

idx_meetings_status_candidate          ON meetings(status, candidate_id)
idx_meetings_interviewer_status        ON meetings(interviewer_id, status)
idx_transcript_segments_meeting_seq    ON transcript_segments(meeting_id, seq)
idx_candidate_presence_status_heartbeat ON candidate_presence(status, last_heartbeat_at)
idx_sessions_expires_at                ON sessions(expires_at)
idx_sessions_user_id                   ON sessions(user_id)
meeting_videos_meeting_id              ON meeting_videos(meeting_id)
```

### Relationship diagram
```
users ──────────────────────────────────────────────────┐
  │  (candidate_id)                                      │
  ├──► meetings ──────────► transcript_segments          │
  │        │                     │                       │
  │        ├──► meeting_participants                     │
  │        ├──► transcript_notes ──► transcript_segments │
  │        └──► meeting_videos                           │
  │                                                      │
  └──► candidate_presence                                │
  └──► sessions                                          │
  └────────────────────────────────────────────────────── (all FKs)
```

---

## 4. Authentication Flow

```
Browser                     Server                    Supabase
   │                           │                          │
   │── signUp/signIn ──────────────────────────────────► │
   │◄── Supabase session (access_token) ─────────────────│
   │                           │                          │
   │── POST /auth/session ─────►                          │
   │   Authorization: Bearer <supabase_access_token>      │
   │                           │── getUser(token) ───────►│
   │                           │◄── { id, email, role,   │
   │                           │      name, language }    │
   │                           │                          │
   │                           │  UPSERT users            │
   │                           │  (language only on INSERT│
   │                           │   not on conflict UPDATE)│
   │                           │                          │
   │◄── { token, user } ───────│                          │
   │    (internal JWT, 15m TTL)│                          │
```

**Internal JWT payload** (`InternalJwtPayload`, `server/src/auth/jwt.ts`):
```json
{ "userId": "uuid", "email": "...", "role": "interviewer",
  "orgId": null, "language": "english", "iat": 0, "exp": 0 }
```

**Token storage**: `localStorage.getItem('auth_token')` (`client/src/utils/tokenStorage.js`).

**Token refresh**: At module load, `useAuthStore.rehydrate()` runs synchronously. If the token is expired, `tryRefresh()` sends `POST /auth/refresh` with the expired token in the `Authorization` header. The server decodes it without expiry check, re-reads the user from DB (picking up current `language`), and issues a fresh 15-minute token. The grace window is 1 hour (`REFRESH_GRACE_MS = 3_600_000`).

**Socket authentication** (`server/src/socket/middleware/requireJwtSocket.ts`): Reads `socket.handshake.auth.token`, calls `verifyInternalJwt()`, attaches result to `socket.data.user`. Role mismatch for the namespace → `next(new Error('AUTH_ERROR: forbidden namespace'))`.

**Reconnect tokens** (`SessionService`): On every socket connect, the server issues a 256-bit URL-safe base64 token (TTL: `SESSION_TTL_SECONDS`, default 60s), persisted in `sessions` table. The client stores it in `sessionStorage` keyed by role. On reconnect, the token is sent in `socket.handshake.auth.reconnect_token` and consumed atomically via `DELETE...RETURNING` — one-shot, prevents replay.

---

## 5. Meeting Lifecycle

### State machine

```
                              ┌─ claim_expired ─►  waiting ◄──┐
                              │                                 │
[open] ──interviewer_join──►[active]               [claimed]───┘
  │                            │
  │    [waiting]──claim──►[claimed]──candidate_join──►[connecting]──both_connected──►[active]
  │                                                         │
  └──end──►[ended]◄──grace_expired──[interrupted]◄──disconnect──┘
                                        │
                                     reconnect
                                        │
                                     [active]
[waiting|claimed|connecting]──cancel──►[cancelled]
```

### Transitions and side effects

| Event | From → To | Trigger | Side effects |
|---|---|---|---|
| `interviewer_join` | `open` → `active` | `MeetingService.onInterviewerJoin` | `Deepgram.start()`, `broadcast.meetingStatus('active')`, `broadcast.openRoomsUpdate()` |
| `disconnect` | `connecting\|active` → `interrupted` | `MeetingService.onParticipantDisconnect` | `scheduleGraceExpiry(30s)`, `broadcast.meetingStatus('interrupted')` |
| `reconnect` | `interrupted` → `active` | `MeetingService.onParticipantReconnect` | `scheduler.cancel(grace_expiry)`, `broadcast.meetingStatus('active')` |
| `end` | `open\|active\|interrupted` → `ended` | `MeetingService.endMeeting` | `Deepgram.stop()`, `transcriptService.clearSeqCounter()`, `broadcast.meetingStatus('ended')`, `broadcast.openRoomsUpdate()` |
| `grace_expired` | `interrupted` → `ended` | `JobScheduler` callback | Same as `end` |
| `claim_expired` | `claimed` → `waiting` | `JobScheduler` callback | `presenceService.broadcastPresenceDelta()` [legacy] |

**Deepgram** is started twice for the same meeting in the primary flow: once in `createOpenMeeting` (so the candidate's audio is captured from the moment they join their solo room) and once in `onInterviewerJoin` (guarded by the session's `has()` check — the second call is a no-op).

---

## 6. Socket Architecture

### `/candidate` namespace

**Middleware:** `requireJwtSocket(role='candidate')` → `attachReconnectSession`

**`socket.data` shape:**
```ts
{ user: InternalJwtPayload & {exp,iat}, meetingId?: string,
  meetingStatus?: MeetingStatus, session?: SessionRecord }
```

| Event (client→server) | Rate limit | Handler |
|---|---|---|
| `start_session` | 5/60s | Creates open meeting, emits `meeting_attached` |
| `heartbeat` | 1/8s | No-op (legacy keepalive) |
| `audio_chunk` (Buffer) | inline byte-rate | Forward to `DeepgramManager.send()` if status is active/open |
| `add_note` | 30/60s | `TranscriptService.addNote`, `broadcast.noteAdded` |
| `update_note` | 30/60s | Author check, `TranscriptService.updateNote` |
| `delete_note` | 30/60s | Author check, `TranscriptService.deleteNote` |
| `share_video` | 10/60s | Supabase Storage signed URL → `video_available` to all namespaces |
| `video_play/pause/seek` | 60/60s | Sync to `meeting:${id}` room on all namespaces |

**Server→client events:** `session_established`, `session_replaced`, `socket_error`, `meeting_attached`, `meeting_status`, `transcript_segment`, `transcript_error`, `note_added`, `note_updated`, `note_deleted`, `video_available`, `video_play_sync`, `video_pause_sync`, `video_seek_sync`

**audio_chunk guard** (`candidate.ts:218`): Skips if `meetingStatus !== 'active' && meetingStatus !== 'open'`, or not in `meeting:${id}` room, or chunk size outside 1–32768 bytes. Inline byte-rate limit: 200KB/second window.

---

### `/interviewer` namespace

**Middleware:** `requireJwtSocket(role='interviewer')` → `attachReconnectSession`

**`socket.data` shape:**
```ts
{ user: InternalJwtPayload & {exp,iat}, meetingId?: string, session?: SessionRecord }
```

| Event (client→server) | Rate limit | Handler |
|---|---|---|
| `subscribe_open_rooms` | 20/60s | Join `open_rooms_monitor` room; return language-filtered list |
| `join_open_meeting` | 10/60s | Language pre-flight query → `MeetingService.onInterviewerJoin` → Agora token → broadcasts |
| `join_room` | 20/60s | Legacy reconnect path for active/interrupted meetings |
| `end_meeting` | 10/60s | Owner check → `MeetingService.endMeeting` → broadcasts |
| `add_note` | 30/60s | Owner check → `TranscriptService.addNote` |
| `update_note` / `delete_note` | 30/60s | Author check |
| `share_video` | 10/60s | Signed URL generation → `video_available` broadcast |
| `video_play/pause/seek` | 60/60s | Sync to meeting room |

**Server→client events:** All shared events + `open_rooms_update`, `candidate_queue_update` (legacy)

All listeners are registered **before** the `await resumeOrAttachCurrentMeeting()` call (`interviewer.ts:401`) so no events are silently dropped during async reconnect initialization.

---

### `/supervisor` namespace

**Middleware:** `requireJwtSocket(role='supervisor')` → `attachReconnectSession`

**`socket.data` shape:**
```ts
{ user: InternalJwtPayload & {exp,iat}, session?: SessionRecord }
```
No `meetingId` — supervisors do not own meetings.

| Event (client→server) | Rate limit | Handler |
|---|---|---|
| `subscribe_active_meetings` | 20/60s | Join `meetings_monitor` room; return language-filtered list |
| `join_room` | 30/60s | Subscriber Agora token (RtcRole.SUBSCRIBER), return segments+notes |

**Server→client events:** All staff shared events + `meeting_status` (from `meeting:{id}` room AND `meetings_monitor` room, deduplicated by Socket.IO).

Supervisors' Agora UIDs are **not** prefixed `_sv_` in the new flow. They use `AgoraTokenService.deriveUid()` like everyone else but receive SUBSCRIBER tokens, so they never publish tracks and never appear in remote users' `user-published` events.

---

## 7. Real-time Data Flow

### Flow A: Candidate starts session → appears on interviewer dashboard

```
Candidate browser                Server                  Interviewer browser
      │                             │                           │
      │─ socket.emit('start_session')►                          │
      │                     createOpenMeeting()                 │
      │                     (INSERT meetings status='open')     │
      │                     DeepgramManager.start()             │
      │◄─ meeting_attached ─────────│                           │
      │   (meetingId, agoraChannel, │                           │
      │    agoraToken, uid)         │                           │
      │                     broadcast.openRoomsUpdate()         │
      │                     [fetch sockets in open_rooms_monitor│
      │                      query DB per socket language]      │
      │                             │── open_rooms_update ─────►│
      │                             │   { meetings: [...] }     │
      │                             │                    setOpenRooms(meetings)
```

### Flow B: Interviewer joins → both enter InterviewRoom

```
Interviewer                      Server                       Candidate
      │                             │                             │
      │─ join_open_meeting ─────────►                             │
      │  { meetingId }              │                             │
      │                    [language pre-flight query]            │
      │                    MeetingService.onInterviewerJoin()     │
      │                    (UPDATE meetings SET status='active')  │
      │                    DeepgramManager.start() [no-op]       │
      │                             │── meeting_status('active')►│
      │                             │   { interviewerName,        │
      │                             │     participantUids }       │
      │◄─ meeting_attached ─────────│                             │
      │   (agoraToken, uid)         │── open_rooms_update ───────►│ (other interviewers)
      │                             │                             │
      │  client.join(channel)       │                    client.join(channel)
      │  publish audio+video        │                    publish audio+video
```

### Flow C: Candidate speaks → transcript appears

```
Candidate mic → AgoraRTC.createMicrophoneAudioTrack()
             → getMediaStreamTrack()
             → AudioContext(16kHz) + AudioWorklet('/audio-processor.js')
             → PCM Int16 chunks
             → socket.emit('audio_chunk', buffer)  [candidate→/candidate]
             → Server: DeepgramManager.send(meetingId, chunk)
             → Deepgram WebSocket (linear16, 16kHz, nova-2)
             → Deepgram fires Transcript event (is_final=true)
             → TranscriptService.appendSegment() → INSERT transcript_segments
             → onSegment callback → BroadcastHelper.transcriptSegment()
             → Socket.IO: emit 'transcript_segment' to meeting:{id}
                on /interviewer, /candidate, /supervisor namespaces
             → Client: useTranscriptStore.addSegment(segment)
             → TranscriptBox re-renders
```

### Flow D: Interviewer edits transcript

```
Interviewer clicks segment text → contentEditable blur
→ socket.emit('add_note', { meetingId, body, anchorSegmentId: segment.id })
→ Server: TranscriptService.addNote() → INSERT transcript_notes
→ broadcast.noteAdded() → 'note_added' to meeting:{id} on all namespaces
→ Client: useTranscriptStore.addNote(note)
→ TranscriptBox: notesBySegmentId[seg.id] now has a note
→ EditableSegment displays note.body instead of segment.text (underlined)
```

### Flow E: Meeting ends → both navigate away

```
Interviewer: socket.emit('end_meeting', { meetingId, reason })
→ Server: MeetingService.endMeeting()
  → UPDATE meetings SET status='ended'
  → UPDATE candidate_presence SET status='offline'
  → Deepgram.stop(meetingId)
  → transcriptService.clearSeqCounter(meetingId)
  → broadcast.meetingStatus(meetingId, 'ended')
  → broadcast.openRoomsUpdate()
→ All clients receive 'meeting_status' { status: 'ended' }
→ useMeetingStore.applyMeetingStatus({ status: 'ended' })
→ InterviewRoom shows terminated overlay + 5-second countdown
→ clearMeeting() + clearTranscript() → navigate('/interviewer' | '/candidate')
History stored: transcript_segments and transcript_notes remain in DB,
queryable via GET /candidates/:id/history/:meetingId/transcript
```

---

## 8. HTTP API

All routes use `Bearer <internal_JWT>` unless noted. Error shape: `{ error: string, code: string }`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/auth/session` | Supabase JWT | Exchange Supabase token for internal JWT |
| `POST` | `/auth/refresh` | Expired internal JWT | Reissue within 1-hour grace window |
| `GET` | `/auth/me` | Internal JWT | Return `req.user` (decoded JWT payload) |
| `GET` | `/meetings/:id` | JWT + `canViewMeeting` | Meeting details + computed Agora UIDs |
| `GET` | `/meetings/:id/transcript` | JWT + `canViewMeeting` | Segments, `afterSeq` cursor, `limit` (max 500) |
| `GET` | `/meetings/:id/notes` | JWT + `canViewMeeting` | Notes, optional `updatedAfter` ISO filter |
| `POST` | `/meetings/:id/videos/upload-url` | JWT + `canViewMeeting` | Supabase Storage signed upload URL + `storagePath` |
| `POST` | `/meetings/:id/videos` | JWT + `canViewMeeting` | Save video metadata → returns `{ videoId }` |
| `GET` | `/meetings/:id/videos/:videoId/stream-url` | JWT + `canViewMeeting` | 1-hour signed read URL |
| `GET` | `/candidates/:id/history` | JWT + `canViewCandidateHistory` | List ended meetings (summary rows) |
| `GET` | `/candidates/:id/history/:mid/transcript` | JWT + `canViewCandidateHistory` | All segments (up to 5000) |
| `GET` | `/candidates/:id/history/:mid/notes` | JWT + `canViewCandidateHistory` | All notes |
| `GET` | `/metrics` | **None** (TODO: add auth) | Active meetings, queue depth, scheduled jobs, Deepgram sessions |
| `GET` | `/health` | None | `{ status, version, nodeEnv, uptime }` |

**Video upload body** (`POST /meetings/:id/videos/upload-url`): `{ filename: string, contentType: "video/mp4"|"video/webm"|"video/quicktime" }`. Storage path format: `{meetingId}/{uuid}-{sanitized_filename}`.

---

## 9. Client Architecture

### Pages

| Page | Route | Role | Socket namespace |
|---|---|---|---|
| `LoginPage` | `/` | Any | None |
| `RegisterPage` | `/register` | Any | None |
| `CandidateWaitingRoom` | `/candidate` | candidate | `/candidate` |
| `InterviewerDashboard` | `/interviewer` | interviewer | `/interviewer` |
| `SupervisorDashboard` | `/supervisor` | supervisor | `/supervisor` |
| `InterviewRoom` | `/room/:roomId` | all roles | `/candidate`, `/interviewer`, or `/supervisor` |

`App.jsx` uses `AppInit` to gate rendering until `useAuthStore.hydrated` is true. `ProtectedRoute` enforces role. `RoomGuard` allows authenticated users OR anyone with a matching `roomId` in `useRoomStore` (legacy path; current flow uses JWT auth for all).

---

### Zustand stores

#### `useAuthStore` (`client/src/store/useAuthStore.js`)
| Field | Type | Notes |
|---|---|---|
| `user` | `{ userId, email, role, name, language }` \| null | null until authenticated |
| `token` | string \| null | Internal JWT |
| `isAuthenticated` | boolean | |
| `hydrated` | boolean | false until rehydrate/tryRefresh settles |

Actions: `login(user, token)`, `logout()`, `rehydrate()` (sync), `tryRefresh(expiredToken)` (async). The `userFromPayload()` helper reads `language ?? null` from the JWT. Module-level self-hydration runs at import time before any React render.

#### `useMeetingStore` (`client/src/store/useMeetingStore.js`)
| Field | Type | Notes |
|---|---|---|
| `meetingId` | UUID \| null | |
| `agoraChannel` | string \| null | |
| `agoraUid` | number \| null | Server-assigned |
| `candidateId` / `interviewerId` | UUID \| null | |
| `candidateName` / `interviewerName` | string \| null | |
| `candidateAgoraUid` / `interviewerAgoraUid` | number \| null | SHA-256 derived |
| `status` | meeting status string | mirrors server enum + `idle` |

Actions: `setWaiting()`, `setMeetingJoined({...})`, `applyMeetingStatus({meetingId, status})`, `setParticipantNames({...})`, `clearMeeting()`. `agoraToken` is intentionally never stored here — passed directly to `joinChannel()`.

#### `useTranscriptStore` (`client/src/store/useTranscriptStore.js`)
| Field | Type | Notes |
|---|---|---|
| `segments` | `SegmentRow[]` | Ordered by `seq`; finals only |
| `interimSegment` | `{ text }` \| null | Live partial, not persisted |
| `notes` | `NoteRow[]` | Ordered by `createdAt` |
| `transcriptionFailed` | boolean | |

Actions: `addSegment(segment)` (deduplicates by id), `setInterimSegment(partial)`, `setInitialData({segments, notes})`, `mergeCatchupData({segments, notes})` (merge-by-id + sort), `addNote/updateNote/removeNote`, `setTranscriptionFailed(bool)`, `clearTranscript()`.

---

### Hooks

**`useAgora`** (`client/src/hooks/useAgora.js`): Manages the Agora RTC client lifecycle. Creates `AgoraRTC.createClient({mode:'rtc', codec:'vp8'})` on `joinChannel()`. Supervisors join as subscriber-only (no audio/video tracks created). Exposes `localVideoRef`, `localAudioTrack`, `remoteUsers`, `joinChannel`, `leaveChannel`, `toggleMute`, `toggleCamera`. Uses `startTransition` for `setRemoteUsers` updates to avoid concurrent-render issues. `mountedRef` guards all async operations against stale updates after unmount.

**`useTranscript`** (`client/src/hooks/useTranscript.js`): Manages the audio pipeline for candidates. `localAudioTrack.getMediaStreamTrack()` → `AudioContext(16kHz)` → `AudioWorklet('/audio-processor.js')` → `socket.emit('audio_chunk', buffer)`. Skips if `pausedRef.current` is true (muted). Health-check timer logs pipeline state every 15 seconds. Heartbeat timer fires `socket.emit('heartbeat')` every 10 seconds independently of the audio pipeline.

**`useSocket`** (`client/src/hooks/useSocket.js`): Module-level singleton map `{ interviewer, candidate, supervisor }`. `getSocket(role)` creates the socket once; subsequent calls return the same instance. Stores reconnect tokens in `sessionStorage` keyed by role. Persists `meeting_attached` payloads in `sessionStorage` so navigation away and back can reattach. On `session_replaced`, logs out and disconnects all.

**`useVideoResume`** (`client/src/hooks/useVideoResume.js`): Manages Flow A (file upload) and Flow B (live recording). Upload: `POST /meetings/:id/videos/upload-url` → PUT directly to Supabase Storage via signed URL → `POST /meetings/:id/videos`. Recording (interviewer only): `MediaRecorder` on candidate's `RemoteAudioTrack + RemoteVideoTrack` → chunks → Blob → same upload path. Synchronized playback via `video_play_sync/video_pause_sync/video_seek_sync` events. `syncingRef` prevents feedback loops when applying remote sync.

---

### `InterviewRoom` component tree

```
InterviewRoom (page — manages socket events, useAgora, useTranscript)
├── ConnectionLostBanner (conditional)
├── <header> (logo, connection dot, role badge, language badge, meeting ID)
│
├── [mobile: isMobile=true]
│   ├── <div.aspect-video.flex-shrink-0>
│   │   └── VideoGrid (PiP layout: remote full, local draggable overlay)
│   ├── <div.flex-1.min-h-0.overflow-hidden>   ← panel content wrapper
│   │   └── PanelContent (module-level component, stable identity)
│   │       ├── TranscriptBox        [activeTab='transcript']
│   │       ├── NotesPanel           [activeTab='notes', supervisor only]
│   │       ├── VideoResumePanel     [activeTab='video']
│   │       └── <div.hidden | h-full.overflow-hidden>
│   │           └── HistoryPanel     [mounted after first open, display:none when inactive]
│   └── bottom bar (mic/cam | tab icons | end call)
│
└── [desktop: isMobile=false]
    ├── <div.flex-[3]> left column
    │   ├── <div.flex-1.min-h-0> VideoGrid
    │   └── ParticipantPanel (collapsible on mobile)
    ├── <div.flex-[2]> right sidebar
    │   ├── tab bar (Transcript / Notes / Video / History)
    │   └── PanelContent (same component as mobile)
    ├── RoomControls (footer — mute, camera, end call)
    ├── interrupted overlay (fixed, z-40)
    └── terminated overlay (fixed, z-50, 5-second countdown)
```

`PanelContent` is defined **outside** `InterviewRoom` to prevent re-creation on every render (which would reset `HistoryPanel` scroll position). `HistoryPanel` stays mounted after first open (`historyOpened` flag), hidden via `display:none` (`hidden` class) rather than unmounting.

---

## 10. Agora Integration

**UID derivation** (`server/src/domain/AgoraTokenService.ts:31`):
```ts
SHA-256(`${meetingId}:${userId}`) → readUInt32BE(0) >>> 1 || 1
```
First 4 bytes of the hash, sign bit cleared (31-bit positive integer), never 0 (Agora treats 0 as "any user"). Deterministic: same meeting+user → same UID always, allowing token reissue on reconnect without a DB lookup.

**Token generation**: `RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, channel, uid, role, expireAt)`. Interviewers and candidates → `RtcRole.PUBLISHER`. Supervisors → `RtcRole.SUBSCRIBER`. TTL: `AGORA_TOKEN_TTL_SECONDS` (default 3600s). Tokens are issued server-side only, never client-derived.

**PiP layout** (`VideoGrid.jsx`): For interviewer/candidate, the remote user's video fills the container absolutely (`RemoteTile`). The local video is a draggable overlay (`PipTile`): desktop 160×120px, mobile 96×72px, locked to bottom-right. Drag uses `window.addEventListener('mousemove')` on `onMouseDown`, clamped to container bounds. Mobile drag is disabled.

**Supervisor view** (`VideoGrid.jsx:226`): Side-by-side `VideoTile` components. Supervisors never appear as `remoteUsers` on other clients because they never publish tracks.

**AudioContext resume**: `useAgora` listens to `document.visibilitychange` and `window.focus` to call `AgoraRTC.getAudioContext().resume()` — browsers auto-suspend AudioContext on tab switch.

---

## 11. Deepgram Integration

**Session lifecycle** (`server/src/lib/DeepgramManager.ts`):
- `start(meetingId, candidateId)` — opens a WebSocket connection to Deepgram with: `model:nova-2, language:en-US, encoding:linear16, sample_rate:16000, channels:1, interim_results:true, endpointing:300`
- `send(meetingId, chunk)` — forwards PCM chunk as `ArrayBuffer`. If not connected, buffers up to 160KB (~5s of audio)
- `stop(meetingId)` — `requestClose()`, clears buffer, deletes session

**Reconnect logic**: Exponential backoff — 500ms, 1000ms, 2000ms (max 8000ms), `MAX_RETRIES=3`. On reconnect success, inserts a **gap segment** (`speaker_role='system'`, text=`[transcription gap: Ns]`) to mark dead air. After 3 failed retries, calls `onFatalError` → `broadcast.transcriptError(meetingId)`.

**Audio pipeline** (client → server → Deepgram):
```
Agora mic track → getMediaStreamTrack()
→ AudioContext(16kHz) + AudioWorklet('pcm-processor')
→ Int16 PCM buffer → socket.emit('audio_chunk', buffer)
→ candidate.ts:audio_chunk handler
→ DeepgramManager.send(meetingId, chunk)
→ Deepgram WebSocket.send(ArrayBuffer)
→ Deepgram fires LiveTranscriptionEvents.Transcript
→ if (is_final) → TranscriptService.appendSegment()
→ onSegment callback → BroadcastHelper.transcriptSegment()
→ socket 'transcript_segment' to all in meeting:{id}
```

**Paused state**: `pausedRef.current` in `useTranscript` — when true (microphone muted), the `AudioWorklet.port.onmessage` handler returns early without emitting. The AudioContext is resumed on unmute.

**Health check**: `setInterval(15_000)` logs `chunks`, `paused`, `socketConnected`, `trackState`, `trackEnabled`, `audioContextState` to `console.log` via `mediaLogger.js`.

---

## 12. Video Resume Feature

### Flow A — Candidate/interviewer uploads a file

```
1. Client: POST /meetings/:id/videos/upload-url
   Body: { filename, contentType }
   Server: supabaseAdmin.storage.createSignedUploadUrl(storagePath)
   Response: { uploadUrl, storagePath }

2. Client: PUT {uploadUrl}  (direct to Supabase Storage, no server hop)
   Body: file binary, Content-Type header

3. Client: POST /meetings/:id/videos
   Body: { storagePath, type:'candidate_upload'|'interviewer_recording',
           candidateName, interviewerName? }
   Server: INSERT meeting_videos → returns { videoId }

4. Client: socket.emit('share_video', { meetingId, videoId })
   Server: SELECT storage_path FROM meeting_videos WHERE id=$1
   Server: supabaseAdmin.storage.createSignedUrl(storage_path, 3600)
   Server: emit 'video_available' { videoId, signedUrl, sharedBy }
         → /interviewer, /candidate, /supervisor in meeting:{id} room

5. All clients: useVideoResume sets sharedVideo → <video src={signedUrl}>
```

### Flow B — Interviewer records live candidate video

```
1. Interviewer: startRecording(remoteUsers)
   Finds candidate by candidateAgoraUid in remoteUsers
   candidateUser.videoTrack.getMediaStreamTrack()
   candidateUser.audioTrack.getMediaStreamTrack()
   new MediaStream([videoTrack, audioTrack])
   new MediaRecorder(stream, { mimeType: 'video/webm' })
   recorder.start(1000)  — 1s chunks

2. Interviewer: stopRecording()
   recorder.stop() → ondataavailable → Blob(chunks, 'video/webm')
   → same upload flow as Flow A (type: 'interviewer_recording')

3. Synchronized playback:
   play/pause/seek events on <video> → socket.emit('video_play|pause|seek', ...)
   Server: re-emit to meeting room on all namespaces
   Remote clients: onPlaySync/onPauseSync/onSeekSync set video.currentTime
   syncingRef prevents feedback: local events suppressed while applying remote
```

Seek events are debounced 300ms (`SEEK_DEBOUNCE_MS`) to avoid flooding on scrub.

---

## 13. Language Filtering

Language flows through every layer of the system:

```
Registration:
  supabase.auth.signUp({ options: { data: { language } } })
  → user_metadata.language stored in Supabase Auth

Session creation (POST /auth/session):
  verifySupabaseToken() reads user_metadata?.language ?? 'english'
  INSERT INTO users (..., language) ON CONFLICT DO UPDATE SET email, name
  (language only set on INSERT — never overwritten on re-login)
  issueInternalJwt({ ..., language: dbUser.language })

Socket connection:
  requireJwtSocket → verifyInternalJwt → socket.data.user.language
  Fallback at every read site: socket.data.user?.language ?? 'english'

Meeting filtering:
  getOpenMeetingsWithNames(language) → WHERE u.language = $1
  getActiveMeetingsWithNames(language) → WHERE ca.language = $1

Real-time broadcast:
  BroadcastHelper.openRoomsUpdate() → fetchSockets('open_rooms_monitor')
  → per-socket: lang = s.data.user?.language ?? 'english'
  → per-socket: getOpenMeetingsWithNames(lang) → s.emit('open_rooms_update')

UI display:
  useAuthStore.user.language (from JWT payload, ?? null for old tokens)
  InterviewRoom header badge: capitalize(user?.language ?? 'english')
  Dashboard subtitle: "Showing English rooms"
```

---

## 14. Security Model

### `canViewMeeting` (`server/src/policy/canViewMeeting.ts`)
| Role | Condition |
|---|---|
| `supervisor` / `admin` | Always allowed |
| `interviewer` | `interviewerId === null` (open meeting, allows hydration before join) OR `interviewerId === userId` |
| `candidate` | `candidateId === userId` |
| Other | Denied |

### `canViewCandidateHistory` (`server/src/policy/canViewCandidateHistory.ts`)
| Role | Condition |
|---|---|
| `interviewer` / `supervisor` / `admin` | Always allowed |
| `candidate` | `candidateId === userId` |
| Other | Denied |

### `join_open_meeting` language pre-flight (`interviewer.ts`)
Queries `meetings JOIN users ON candidate_id` for the candidate's language before calling `onInterviewerJoin()`. Language mismatch → `ack({ ok: true })` silent (the filtered room list means this is a race-condition guard only). DB error → `ack({ ok: false, code: 'INTERNAL_ERROR' })`. If no row found (meeting already taken), proceeds to `onInterviewerJoin` which throws `InvalidTransitionError` → CONFLICT response.

### What is enforced server-side
- JWT presence and validity on every HTTP route (`requireAuth`) and socket connection (`requireJwtSocket`)
- Role matching to namespace (`requireJwtSocket` role parameter)
- Meeting ownership for `end_meeting`, `join_room` reconnect (checks `interviewerId === userId`)
- Note authorship for `update_note`, `delete_note`
- Language filtering in DB queries (not just UI)
- One-shot reconnect tokens (consumed on use via `DELETE...RETURNING`)
- Rate limits on all socket events (in-memory sliding window)
- HTTP rate limit: 20 requests/minute on `/auth` routes

### Known limitations (not enforced)
- Supervisor's stealth is enforced by the SUBSCRIBER Agora token (cannot publish) but the supervisor's presence in the Agora channel is visible to Agora's own dashboard
- Language filtering applies only to the room list query and pre-flight check — once a meeting is active, there is no check preventing a different-language supervisor from joining via `join_room` with a known `meetingId`
- `canViewMeeting` allows any interviewer to read an open meeting's transcript (necessary for pre-join hydration) — an interviewer could read another interviewer's candidate transcript before joining
- `/metrics` endpoint is unauthenticated (noted with TODO comment in `server/src/http/metrics.ts:7`)

---

## 15. Key Design Decisions & Trade-offs

**1. No Redis — `setTimeout` + DB for job scheduling** (`JobScheduler.ts`). All timers are in-process `setTimeout` calls with `.unref()`. At boot, `recovery.ts` reads `claimed` and `interrupted` meetings from the DB and reschedules their timers. Trade-off: jobs survive planned restarts but are lost on crash if the DB write hasn't committed. Recovery mitigates this for all realistic crash scenarios.

**2. Append-only transcript segments** (`TranscriptService.appendSegment`). Segments are never updated or deleted. Corrections are expressed as `transcript_notes` with an `anchor_segment_id`. `TranscriptBox` displays `note.body` instead of `segment.text` when a note exists for a segment (underlined). Trade-off: historical accuracy is preserved; display logic is slightly more complex.

**3. `socket.data.meetingStatus` cache** (`candidate.ts:218`). The `audio_chunk` handler checks `socket.data.meetingStatus` rather than querying the DB. This avoids a round-trip on every 160-byte PCM chunk (many per second). Trade-off: briefly stale after a meeting status transition — guarded by the `meeting:${meetingId}` room membership check as a secondary guard.

**4. In-flow mobile bottom bar** (`InterviewRoom.jsx:487`). The bottom navigation bar is an in-flow `flex-shrink-0 h-14` element, not `position:fixed`. This avoids the classic mobile-browser virtual keyboard / safe-area bug where fixed-positioned elements overlap content. Trade-off: requires `min-h-0` on all `flex-1` flex children to prevent content from escaping the constrained column layout.

**5. Per-socket broadcast filtering** (`BroadcastHelper.openRoomsUpdate`). Instead of one `emit` to the `open_rooms_monitor` room, the method fetches all sockets in the room and issues one DB query per socket (language-filtered). Trade-off: O(n) DB queries where n is the number of subscribed interviewers. For typical deployments (< 50 concurrent interviewers) this is negligible, and it eliminates the need for each interviewer to filter client-side.

**6. Deterministic SHA-256 Agora UIDs** (`AgoraTokenService.deriveUid`). UID = `SHA-256("meetingId:userId")[0:4] >>> 1 || 1`. No DB lookup on reconnect. Trade-off: collision probability is ~1 in 2^31 per meeting, effectively zero. The `|| 1` avoids Agora's special case for UID 0 ("any user").

**7. No React StrictMode** (`client/src/main.jsx`). StrictMode double-invokes effects in development, which causes `useAgora` to join the Agora channel twice (no idempotency on Agora's SDK) and `useSocket` to create duplicate socket connections. Trade-off: development mode behaves identically to production; double-invoke safety checks are foregone.

**8. Module-level socket singletons** (`useSocket.js:7`). Sockets live outside React state in a module-level map. Component remounts — which are common in React 19's concurrent mode — do not disconnect and reconnect. Trade-off: one socket per role per browser tab; the `session_replaced` event handles multi-tab detection server-side.

**9. In-memory seq counter for transcript** (`TranscriptService.seqCounters`). After the first `appendSegment` call for a meeting, `MAX(seq)` is fetched once and cached. Subsequent calls increment in memory. Trade-off: the counter resets on server restart. The `recovery.ts` boot scan does not re-hydrate seq counters — `appendSegment` re-reads `MAX(seq)` from DB on the first call after restart, so the first post-restart segment gets the correct seq.

**10. Dual-auth pattern (Supabase + internal JWT)** (`auth.ts`). Supabase handles identity (OAuth-compatible, email confirmation, secure password storage). The server then issues its own short-lived JWT containing `userId`, `role`, `language`, and `orgId`. This decouples the socket/API auth from Supabase's token format and TTL. Trade-off: an extra HTTP round-trip on every login/page-load refresh, and two token systems to reason about. The benefit is that internal tokens are fast to verify (local HMAC) and carry custom claims without a Supabase round-trip per request.
