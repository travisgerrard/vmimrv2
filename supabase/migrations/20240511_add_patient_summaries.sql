-- Migration: Add patient_summaries table for patient-friendly post rewrites
CREATE TABLE IF NOT EXISTS patient_summaries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id uuid REFERENCES posts(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    summary_text text NOT NULL,
    feedback text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_summaries_post_id ON patient_summaries(post_id);
CREATE INDEX IF NOT EXISTS idx_patient_summaries_user_id ON patient_summaries(user_id); 