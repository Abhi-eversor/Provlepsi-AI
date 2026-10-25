-- Apply once to an empty development database using the Neon SQL editor.
-- This is the schema required by the current authentication routes.
-- Existing databases should be reviewed rather than overwritten.
CREATE TABLE IF NOT EXISTS public.users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  gender TEXT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);

-- Enforces the same normalization used by login and signup, without rewriting
-- historical account records. Existing case-insensitive duplicates must first
-- be reconciled explicitly; never delete accounts automatically to satisfy it.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_key
  ON public.users (lower(btrim(email)));

-- Shared fixed-window counters; keys are HMACs, never raw emails or IP addresses.
CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0)
);
CREATE INDEX IF NOT EXISTS auth_rate_limits_window_started_at_idx
  ON public.auth_rate_limits (window_started_at);
