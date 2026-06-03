-- Depends on 0002_open_meetings.sql (enum value 'open' must already exist).

-- Allow interviewer_id to be NULL: candidates now create solo rooms before
-- an interviewer joins.
ALTER TABLE meetings ALTER COLUMN interviewer_id DROP NOT NULL;

-- Extend the partial unique index to include 'open' so a reconnecting candidate
-- cannot create a second open room while their first one is still live.
DROP INDEX one_active_meeting_per_candidate;

CREATE UNIQUE INDEX one_active_meeting_per_candidate
  ON meetings(candidate_id)
  WHERE status IN ('open', 'claimed', 'connecting', 'active', 'interrupted');
