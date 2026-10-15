import { neon } from '@neondatabase/serverless';

export function getSql() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be set to a Neon PostgreSQL connection string.');
  }
  return neon(databaseUrl);
}
