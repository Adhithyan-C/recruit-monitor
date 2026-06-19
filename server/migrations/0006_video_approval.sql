-- ── Video Approval ───────────────────────────────────────────────────────────
-- Allows an interviewer to mark a candidate's video as the permanent, approved
-- one. Once approved, no further uploads are permitted for that candidate
-- (enforced by the partial unique index below + an application-level guard).

ALTER TABLE meeting_videos
  ADD COLUMN approved_at TIMESTAMPTZ NULL,
  ADD COLUMN approved_by UUID NULL REFERENCES users(id);

CREATE UNIQUE INDEX one_approved_video_per_candidate
  ON meeting_videos(candidate_id) WHERE approved_at IS NOT NULL;

CREATE INDEX meeting_videos_candidate_created
  ON meeting_videos(candidate_id, created_at DESC);
