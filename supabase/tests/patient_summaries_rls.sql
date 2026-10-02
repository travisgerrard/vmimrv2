-- Run only in a new disposable database named medical_notes_rls_test as its
-- administrator: psql -X -v ON_ERROR_STOP=1 -d medical_notes_rls_test -f this_file
-- This test uses synthetic rows, a mock auth.uid(), and unprivileged roles.
-- It includes the actual migration and rolls back all schema/data/role changes.
\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF current_database() <> 'medical_notes_rls_test'
     OR to_regclass('public.posts') IS NOT NULL
     OR to_regclass('public.patient_summaries') IS NOT NULL THEN
    RAISE EXCEPTION 'Use a new disposable medical_notes_rls_test database';
  END IF;
END;
$$;

CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

CREATE TABLE public.users (id uuid PRIMARY KEY);
CREATE TABLE public.posts (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES public.users(id)
);
\ir ../migrations/20240511_add_patient_summaries.sql

-- Reproduce the live permissive posts SELECT policy. A readable post must
-- still not allow creating another user's patient summary.
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY posts_public_read ON public.posts FOR SELECT TO PUBLIC USING (true);
GRANT SELECT ON public.posts TO anon, authenticated;
GRANT ALL ON public.patient_summaries TO anon, authenticated;

INSERT INTO public.users (id) VALUES
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');
INSERT INTO public.posts (id, user_id) VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002');
INSERT INTO public.patient_summaries (id, post_id, user_id, summary_text) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'synthetic owner A'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'synthetic owner B'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'synthetic mismatched ownership'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', NULL, 'synthetic null owner'),
  ('20000000-0000-0000-0000-000000000005', NULL, '00000000-0000-0000-0000-000000000001', 'synthetic null post');

CREATE FUNCTION pg_temp.assert_equal(actual bigint, expected bigint, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '%: expected %, got %', label, expected, actual;
  END IF;
END;
$$;
CREATE FUNCTION pg_temp.expect_rls_denial(statement text, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE '%row-level security%' THEN
      RAISE EXCEPTION '%: failure was not an RLS denial: %', label, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION '%: expected RLS denial', label;
END;
$$;

-- Verify temporary no-policy containment before adding the approved policies.
ALTER TABLE public.patient_summaries ENABLE ROW LEVEL SECURITY;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_equal((SELECT count(*) FROM public.patient_summaries), 0, 'no-policy containment');
SELECT pg_temp.expect_rls_denial(
  $q$INSERT INTO public.patient_summaries (post_id, user_id, summary_text)
     VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'synthetic')$q$,
  'no-policy insert');
RESET ROLE;

-- In this disposable fixture only, restore the verified production starting
-- state (RLS disabled, no policies) before applying the actual migration.
ALTER TABLE public.patient_summaries DISABLE ROW LEVEL SECURITY;
\ir ../migrations/20261002130004_patient_summaries_public_read_owner_insert.sql

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_equal((SELECT count(*) FROM public.posts), 2, 'foreign post is publicly readable');
SELECT pg_temp.assert_equal((SELECT count(*) FROM public.patient_summaries), 5, 'authenticated user reads every summary');
SELECT pg_temp.assert_equal((SELECT count(*) FROM public.patient_summaries WHERE id = '20000000-0000-0000-0000-000000000002'), 1, 'cross-owner public read');
INSERT INTO public.patient_summaries (post_id, user_id, summary_text, feedback)
VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'synthetic null-feedback insert', NULL);
SELECT pg_temp.assert_equal((SELECT count(*) FROM public.patient_summaries WHERE feedback IS NULL), 6, 'owner insert and public null-feedback read');
INSERT INTO public.patient_summaries (post_id, user_id, summary_text, feedback)
VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'synthetic feedback insert', 'synthetic feedback');
SELECT pg_temp.assert_equal((SELECT count(*) FROM public.patient_summaries WHERE feedback = 'synthetic feedback'), 1, 'owner feedback insert');
SELECT pg_temp.expect_rls_denial(
  $q$INSERT INTO public.patient_summaries (post_id, user_id, summary_text)
     VALUES ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'synthetic')$q$,
  'cross-owner post insert');
SELECT pg_temp.expect_rls_denial(
  $q$INSERT INTO public.patient_summaries (post_id, user_id, summary_text)
     VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'synthetic')$q$,
  'forged summary owner');
SELECT pg_temp.expect_rls_denial(
  $q$INSERT INTO public.patient_summaries (post_id, user_id, summary_text)
     VALUES ('10000000-0000-0000-0000-000000000001', NULL, 'synthetic')$q$,
  'null summary owner');
SELECT pg_temp.expect_rls_denial(
  $q$INSERT INTO public.patient_summaries (post_id, user_id, summary_text)
     VALUES (NULL, '00000000-0000-0000-0000-000000000001', 'synthetic')$q$,
  'null source post');
WITH changed AS (UPDATE public.patient_summaries SET summary_text = 'synthetic update' RETURNING id)
SELECT pg_temp.assert_equal((SELECT count(*) FROM changed), 0, 'update remains denied');
WITH removed AS (DELETE FROM public.patient_summaries RETURNING id)
SELECT pg_temp.assert_equal((SELECT count(*) FROM removed), 0, 'delete remains denied');

SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
SELECT pg_temp.assert_equal((SELECT count(*) FROM public.patient_summaries), 7, 'owner B reads every summary');
SET LOCAL request.jwt.claim.sub = '';
SELECT pg_temp.assert_equal((SELECT count(*) FROM public.patient_summaries), 7, 'authenticated public read without UID');
SELECT pg_temp.expect_rls_denial(
  $q$INSERT INTO public.patient_summaries (post_id, user_id, summary_text)
     VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'synthetic')$q$,
  'authenticated insert without UID');

SET LOCAL ROLE anon;
SET LOCAL request.jwt.claim.sub = '';
SELECT pg_temp.assert_equal((SELECT count(*) FROM public.patient_summaries), 7, 'anon reads every summary');
-- Even an anon request with a spoofed UID must not match the INSERT policy.
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_equal((SELECT count(*) FROM public.patient_summaries), 7, 'anon public read with spoofed UID');
SELECT pg_temp.expect_rls_denial(
  $q$INSERT INTO public.patient_summaries (post_id, user_id, summary_text)
     VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'synthetic')$q$,
  'anon insert');
RESET ROLE;

SELECT pg_temp.assert_equal((SELECT count(*) FROM public.patient_summaries), 7, 'admin verifies only two allowed inserts');
SELECT pg_temp.assert_equal((SELECT count(*) FROM public.patient_summaries WHERE summary_text = 'synthetic update'), 0, 'no updates occurred');
SELECT pg_temp.assert_equal((SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'patient_summaries'), 2, 'only SELECT and INSERT policies');
SELECT pg_temp.assert_equal((SELECT relrowsecurity::int FROM pg_class WHERE oid = 'public.patient_summaries'::regclass), 1, 'RLS enabled');
ROLLBACK;
SELECT 'patient_summaries RLS synthetic tests passed' AS result;
