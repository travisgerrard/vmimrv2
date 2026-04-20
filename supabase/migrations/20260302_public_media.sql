-- Make post-media bucket public so images are visible without authentication
UPDATE storage.buckets SET public = true WHERE id = 'post-media';

-- Allow anyone (including unauthenticated users) to read media_files rows
CREATE POLICY "media_files_public_read"
  ON media_files
  FOR SELECT
  TO anon
  USING (true);
