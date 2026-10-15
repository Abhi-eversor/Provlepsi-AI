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
