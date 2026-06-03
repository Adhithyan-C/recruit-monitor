-- Adds 'open' to meeting_status enum.
-- Must be its own migration: the new value cannot be referenced in the same
-- transaction that adds it (Postgres commits the enum change at the END of the
-- transaction, so subsequent DDL in the same transaction cannot use it yet).

ALTER TYPE meeting_status ADD VALUE 'open' BEFORE 'waiting';
