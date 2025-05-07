-- Drop existing fts column if it exists
ALTER TABLE posts DROP COLUMN IF EXISTS fts;

-- Add fts column as a generated column
ALTER TABLE posts ADD COLUMN fts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

-- Create GIN index for full-text search
CREATE INDEX IF NOT EXISTS idx_posts_fts ON posts USING GIN (fts); 