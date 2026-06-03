ALTER TABLE users
  ADD COLUMN language TEXT NOT NULL DEFAULT 'english'
  CHECK (language IN ('english', 'tamil', 'hindi'));
