-- ── Enums ─────────────────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM ('candidate', 'interviewer', 'supervisor');

CREATE TYPE candidate_status AS ENUM (
  'offline',
  'waiting',
  'claimed',
  'in_meeting',
  'disconnected'
);

CREATE TYPE meeting_status AS ENUM (
  'waiting',
  'claimed',
  'connecting',
  'active',
  'interrupted',
  'ended',
  'cancelled'
);

CREATE TYPE end_reason AS ENUM (
  'interviewer_ended',
  'candidate_left',
  'grace_expired',
  'claim_expired',
  'admin_terminated',
  'error'
);

CREATE TYPE participant_role AS ENUM ('candidate', 'interviewer', 'supervisor');

CREATE TYPE speaker_role AS ENUM ('candidate', 'interviewer', 'system');

-- ── users ─────────────────────────────────────────────────────────────
-- id is set to the Supabase auth.users.id on upsert (not auto-generated here)

CREATE TABLE users (
  id         UUID PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  role       user_role NOT NULL,
  name       TEXT NOT NULL,
  org_id     UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── meetings ──────────────────────────────────────────────────────────
-- Created before candidate_presence because presence.current_meeting_id references it

CREATE TABLE meetings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id   UUID NOT NULL REFERENCES users(id),
  interviewer_id UUID NOT NULL REFERENCES users(id),
  status         meeting_status NOT NULL DEFAULT 'waiting',
  agora_channel  TEXT NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at     TIMESTAMPTZ,
  ended_at       TIMESTAMPTZ,
  end_reason     end_reason
);

-- ── candidate_presence ────────────────────────────────────────────────

CREATE TABLE candidate_presence (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status              candidate_status NOT NULL DEFAULT 'offline',
  socket_id           TEXT,
  last_heartbeat_at   TIMESTAMPTZ,
  claimed_by          UUID REFERENCES users(id),
  claimed_at          TIMESTAMPTZ,
  current_meeting_id  UUID REFERENCES meetings(id),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── meeting_participants ──────────────────────────────────────────────

CREATE TABLE meeting_participants (
  meeting_id      UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id),
  role            participant_role NOT NULL,
  agora_uid       INTEGER NOT NULL,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at         TIMESTAMPTZ,
  disconnected_at TIMESTAMPTZ,
  PRIMARY KEY (meeting_id, user_id)
);

-- ── sessions ──────────────────────────────────────────────────────────
-- One-shot reconnect tokens; issued on socket connect, consumed on reconnect

CREATE TABLE sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reconnect_token TEXT NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── transcript_segments ───────────────────────────────────────────────
-- Append-only. Segments are never updated or deleted.

CREATE TABLE transcript_segments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id      UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  speaker_user_id UUID REFERENCES users(id),
  speaker_role    speaker_role NOT NULL,
  text            TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ NOT NULL,
  is_final        BOOLEAN NOT NULL DEFAULT false,
  confidence      FLOAT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, seq)
);

-- ── transcript_notes ──────────────────────────────────────────────────

CREATE TABLE transcript_notes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id        UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  anchor_segment_id UUID REFERENCES transcript_segments(id),
  author_user_id    UUID NOT NULL REFERENCES users(id),
  body              TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Partial unique index ──────────────────────────────────────────────
-- Enforces that a candidate can only be in one active meeting at a time.
-- "Active" covers the full lifecycle from claim to end.

CREATE UNIQUE INDEX one_active_meeting_per_candidate
  ON meetings(candidate_id)
  WHERE status IN ('claimed', 'connecting', 'active', 'interrupted');

-- ── Performance indexes ───────────────────────────────────────────────

-- Queue queries and meeting lookup by status
CREATE INDEX idx_meetings_status_candidate
  ON meetings(status, candidate_id);

-- Interviewer dashboard: find interviewer's own meetings
CREATE INDEX idx_meetings_interviewer_status
  ON meetings(interviewer_id, status);

-- Transcript pagination and append (TranscriptService seq lookup)
CREATE INDEX idx_transcript_segments_meeting_seq
  ON transcript_segments(meeting_id, seq);

-- Presence queue queries AND the stale sweeper WHERE clause
CREATE INDEX idx_candidate_presence_status_heartbeat
  ON candidate_presence(status, last_heartbeat_at);

-- Session cleanup (sweeper deletes expired sessions)
CREATE INDEX idx_sessions_expires_at
  ON sessions(expires_at);

-- Session lookup by user (e.g. multi-tab detection)
CREATE INDEX idx_sessions_user_id
  ON sessions(user_id);
