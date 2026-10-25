import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { neon } from '@neondatabase/serverless';
import { createAuthRepository } from '../src/lib/db.ts';
import { handleLogin, handleSignup } from '../src/lib/auth-service.ts';

// Opt in ONLY with a separate test database. This creates and drops a random
// isolated schema; it never uses DATABASE_URL or writes public.users.
test('Neon integration: schema, atomic signup, real bcrypt, and shared throttling', {
  skip: !process.env.AUTH_TEST_DATABASE_URL ? 'AUTH_TEST_DATABASE_URL not supplied; no database contacted.' : false,
}, async () => {
  const sql = neon(process.env.AUTH_TEST_DATABASE_URL);
  const schema = `auth_test_${randomBytes(12).toString('hex')}`;
  const isolated = (strings, ...values) => sql.query(
    strings.map((part, i) => part.replaceAll('public.', `"${schema}".`) + (i < values.length ? `$${i + 1}` : '')).join(''), values,
  );
  isolated.transaction = queries => sql.transaction(queries);
  await sql.query(`CREATE SCHEMA "${schema}"`);
  try {
    const ddl = (await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'))
      .replace(/--[^\n]*/g, '').replaceAll('public.', `"${schema}".`);
    for (const statement of ddl.split(';').filter(part => part.trim())) await sql.query(statement);
    const secret = randomBytes(32);
    const repository = createAuthRepository(isolated, secret);
    const deps = { ...repository, ensureConfigured() {}, secureCookies: true,
      createToken: async () => 'integration-token', verifyToken: async () => null };
    const makeRequest = (action, body) => new Request(`https://app.example.invalid/api/auth/${action}`, {
      method: 'POST', headers: { Origin: 'https://app.example.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const input = { name: 'Integration Test', email: 'Integration@Example.Invalid', password: 'integration-only-password' };
    const raced = await Promise.all([handleSignup(makeRequest('signup', input), deps),
      handleSignup(makeRequest('signup', { ...input, email: input.email.toLowerCase() }), deps)]);
    assert.deepEqual(raced.map(res => res.status).sort(), [201, 409]);
    const [count] = await sql.query(`SELECT COUNT(*) AS count FROM "${schema}".users`);
    assert.equal(Number(count.count), 1);
    assert.equal((await handleLogin(makeRequest('login', { email: input.email, password: input.password }), deps)).status, 200);
    assert.equal((await handleLogin(makeRequest('login', { email: input.email, password: 'wrong' }), deps)).status, 401);
    const independentServer = createAuthRepository(isolated, secret);
    for (let i = 0; i < 10; i++) assert.equal(await repository.consumeLimit('login', 'limited@example.invalid'), null);
    assert.ok(await independentServer.consumeLimit('login', 'limited@example.invalid') > 0);
    await sql.query(`UPDATE "${schema}".auth_rate_limits SET window_started_at = clock_timestamp() - INTERVAL '2 hours'`);
    assert.equal(await independentServer.consumeLimit('login', 'limited@example.invalid'), null);
    const [raw] = await sql.query(`SELECT password_hash FROM "${schema}".users`);
    assert.notEqual(raw.password_hash, input.password);
    assert.match(raw.password_hash, /^\$2[aby]\$12\$/);
  } finally {
    await sql.query(`DROP SCHEMA "${schema}" CASCADE`);
  }
});
