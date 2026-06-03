-- ── Meeting Videos ───────────────────────────────────────────────────────────
-- Stores metadata for candidate-uploaded and interviewer-recorded video resumes.
-- Video files live in Supabase Storage bucket "interview-videos" (private).
--
-- MANUAL SETUP REQUIRED — Supabase Storage buckets cannot be created via SQL:
--   1. Go to Supabase Dashboard → Storage → New bucket
--   2. Name: interview-videos
--   3. Public: OFF (private — all access via signed URLs generated server-side)
--   4. File size limit: 200 MB (or your preferred limit)
--   5. Allowed MIME types: video/mp4, video/webm, video/quicktime

CREATE TABLE meeting_videos (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id       UUID        NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  candidate_id     UUID        NOT NULL REFERENCES users(id),
  interviewer_id   UUID        REFERENCES users(id),
  candidate_name   TEXT        NOT NULL,
  interviewer_name TEXT,
  storage_path     TEXT        NOT NULL,
  type             TEXT        NOT NULL CHECK (type IN ('candidate_upload', 'interviewer_recording')),
  meeting_date     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX meeting_videos_meeting_id ON meeting_videos(meeting_id);
