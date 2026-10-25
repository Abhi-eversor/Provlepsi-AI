-- Apply to an existing database before deploying the hardened auth routes.
-- Review this diagnostic first: case-insensitive duplicates cannot safely be
-- merged automatically. Reconcile them with the account owners, then rerun.
SELECT lower(btrim(email)) AS normalized_email, COUNT(*) AS account_count
FROM public.users GROUP BY lower(btrim(email)) HAVING COUNT(*) > 1;

BEGIN;
-- If duplicates exist, PostgreSQL fails here and the transaction rolls back.
-- No existing users, passwords, or original email addresses are rewritten.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_key
  ON public.users (lower(btrim(email)));
CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0)
);
CREATE INDEX IF NOT EXISTS auth_rate_limits_window_started_at_idx
  ON public.auth_rate_limits (window_started_at);
COMMIT;
