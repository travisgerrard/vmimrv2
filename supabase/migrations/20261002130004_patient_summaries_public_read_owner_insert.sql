-- Patient summaries are publicly readable; only the source-post owner may insert.
-- Safe to apply after RLS has already been enabled for temporary containment.
ALTER TABLE public.patient_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY patient_summaries_select_public
  ON public.patient_summaries
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY patient_summaries_insert_owner
  ON public.patient_summaries
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND post_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.posts AS post
      WHERE post.id = patient_summaries.post_id
        AND post.user_id = (SELECT auth.uid())
    )
  );
