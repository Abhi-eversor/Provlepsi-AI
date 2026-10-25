import { neon } from '@neondatabase/serverless';
import { createHmac } from 'node:crypto';
import type { Account, LoginAccount, SignupInput } from './auth-service';

export function getSql() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be set to a Neon PostgreSQL connection string.');
  }
  return neon(databaseUrl);
}

/** Queries use one shared PostgreSQL authority, including atomic rate-limit counters. */
export function createAuthRepository(sql: ReturnType<typeof getSql>, secret: Uint8Array) {
  return {
    async findUser(email: string): Promise<LoginAccount | undefined> {
      const [user] = await sql`SELECT id, name, email, password_hash FROM public.users
        WHERE lower(btrim(email)) = ${email}`;
      return user as LoginAccount | undefined;
    },
    async insertUser(input: Omit<SignupInput, 'password'> & { passwordHash: string }): Promise<Account | undefined> {
      // The normalized-email unique index also protects simultaneous requests.
      const [user] = await sql`INSERT INTO public.users (name, gender, email, password_hash)
        VALUES (${input.name}, ${input.gender}, ${input.email}, ${input.passwordHash})
        ON CONFLICT DO NOTHING RETURNING id, name, email`;
      return user as Account | undefined;
    },
    async getUser(id: number): Promise<Account | undefined> {
      const [user] = await sql`SELECT id, name, email FROM public.users WHERE id = ${id}`;
      return user as Account | undefined;
    },
    async consumeLimit(action: 'login' | 'signup', email: string): Promise<number | null> {
      // Do not trust forwarded IP headers. Account and endpoint-wide limits apply
      // across server instances. A trusted edge can impose additional IP limits.
      const limits = [
        { scope: `${action}:global`, max: action === 'login' ? 120 : 30, seconds: 60 },
        { scope: `${action}:account:${email}`, max: action === 'login' ? 10 : 5, seconds: action === 'login' ? 900 : 3600 },
      ];
      const results = await sql.transaction([
        sql`DELETE FROM public.auth_rate_limits WHERE window_started_at < clock_timestamp() - INTERVAL '1 day'`,
        ...limits.map(({ scope, max, seconds }) => {
          const bucket = createHmac('sha256', secret).update(scope).digest('hex');
          return sql`INSERT INTO public.auth_rate_limits (bucket_key, window_started_at, attempts)
            VALUES (${bucket}, clock_timestamp(), 1)
            ON CONFLICT (bucket_key) DO UPDATE SET
              attempts = CASE WHEN auth_rate_limits.window_started_at <= clock_timestamp() - (${seconds} * INTERVAL '1 second')
                THEN 1 ELSE LEAST(auth_rate_limits.attempts + 1, ${max + 1}) END,
              window_started_at = CASE WHEN auth_rate_limits.window_started_at <= clock_timestamp() - (${seconds} * INTERVAL '1 second')
                THEN clock_timestamp() ELSE auth_rate_limits.window_started_at END
            RETURNING attempts, GREATEST(1, CEIL(EXTRACT(EPOCH FROM
              (window_started_at + (${seconds} * INTERVAL '1 second') - clock_timestamp())))) AS retry_after`;
        }),
      ]);
      let retry: number | null = null;
      limits.forEach((limit, index) => {
        const row = results[index + 1][0];
        if (!row || !Number.isFinite(Number(row.attempts)) || !Number.isFinite(Number(row.retry_after))) {
          throw new Error('Invalid authentication rate-limit response.');
        }
        if (Number(row.attempts) > limit.max) retry = Math.max(retry ?? 0, Number(row.retry_after));
      });
      return retry;
    },
  };
}
