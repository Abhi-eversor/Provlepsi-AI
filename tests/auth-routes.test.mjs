import assert from 'node:assert/strict';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import { handleLogin, handleLogout, handleMe, handleSignup, validateCredentials } from '../src/lib/auth-service.ts';
import { createAuthRepository } from '../src/lib/db.ts';

const account = { id: 7, name: 'Test Person', email: 'person@example.invalid' };
const signup = { name: 'Test Person', email: account.email, password: 'safe-test-password' };
function request(route, body = signup, headers = {}) {
  return new Request(`https://app.example.invalid/api/auth/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://app.example.invalid', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
function dependencies(overrides = {}) {
  return {
    ensureConfigured() {}, findUser: async () => ({ ...account, password_hash: 'hash' }),
    insertUser: async () => account, getUser: async () => account, consumeLimit: async () => null,
    createToken: async () => 'signed-token', verifyToken: async () => ({ userId: account.id, email: account.email }),
    hashPassword: async () => 'hashed', comparePassword: async () => true, secureCookies: true,
    ...overrides,
  };
}

test('auth endpoints reject cross-origin and missing-origin mutations before database access', async () => {
  const deps = dependencies({ consumeLimit: () => { throw new Error('should not access database'); } });
  for (const origin of ['https://attacker.example.invalid', 'null', '']) {
    assert.equal((await handleLogin(request('login', {}, { Origin: origin }), deps)).status, 403);
    assert.equal((await handleSignup(request('signup', {}, { Origin: origin }), deps)).status, 403);
    assert.equal(handleLogout(request('logout', {}, { Origin: origin }), deps).status, 403);
  }
  assert.equal((await handleSignup(request('signup', signup, { 'Sec-Fetch-Site': 'cross-site' }), deps)).status, 403);
});

test('configured public origin supports a proxy without accepting arbitrary forwarded headers', async () => {
  const req = new Request('http://internal:3000/api/auth/signup', {
    method: 'POST', headers: { Origin: 'https://public.example.invalid', 'Content-Type': 'application/json' },
    body: JSON.stringify(signup),
  });
  const res = await handleSignup(req, dependencies({ publicOrigin: 'https://public.example.invalid' }));
  assert.equal(res.status, 201);
});

test('auth rejects malformed, oversized, non-object and wrong-content-type JSON', async () => {
  const deps = dependencies();
  for (const body of ['{', '[]', 'null', '1', '"text"']) {
    assert.equal((await handleSignup(request('signup', body), deps)).status, 400);
  }
  assert.equal((await handleSignup(request('signup', signup, { 'Content-Type': 'text/plain' }), deps)).status, 415);
  assert.equal((await handleSignup(request('signup', ' '.repeat(4097)), deps)).status, 413);
  assert.equal((await handleSignup(request('signup', signup, { 'Content-Length': '9999' }), deps)).status, 413);
});

test('streaming body limits cannot be bypassed by omitting or understating Content-Length', async () => {
  const makeStream = () => new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(3000).fill(32));
      controller.enqueue(new Uint8Array(2000).fill(32));
      controller.close();
    },
  });
  for (const headers of [{}, { 'Content-Length': '10' }]) {
    const req = new Request('https://app.example.invalid/api/auth/signup', {
      method: 'POST', duplex: 'half', body: makeStream(),
      headers: { Origin: 'https://app.example.invalid', 'Content-Type': 'application/json', ...headers },
    });
    assert.equal((await handleSignup(req, dependencies())).status, 413);
  }
  const invalidUtf8 = new Request('https://app.example.invalid/api/auth/signup', {
    method: 'POST', body: new Uint8Array([0xff]),
    headers: { Origin: 'https://app.example.invalid', 'Content-Type': 'application/json' },
  });
  assert.equal((await handleSignup(invalidUtf8, dependencies())).status, 400);
});

test('signup validation normalizes email, trims names, and enforces bcrypt byte limits', () => {
  assert.deepEqual(validateCredentials({ ...signup, email: ' Person@EXAMPLE.invalid ', name: ' Test Person ' }, true), {
    ...signup, gender: null,
  });
  for (const changes of [
    { email: ['person@example.invalid'] }, { email: 'a..b@example.invalid' }, { email: 'a@-bad.invalid' },
    { email: 'a@example.invalid\nBcc:x' }, { name: '' }, { name: 'x'.repeat(101) }, { name: 'Name\0' },
    { password: 'short' }, { password: { value: '123456789012' } }, { password: 'x'.repeat(73) },
    { password: '🔒'.repeat(19) }, { gender: [] }, { unknown: 'value' },
  ]) assert.throws(() => validateCredentials({ ...signup, ...changes }, true));
  assert.equal(validateCredentials({ ...signup, password: '🔒'.repeat(18) }, true).password.length, 36);
  assert.equal(validateCredentials({ email: account.email, password: 'old' }, false).password, 'old');
});

test('successful signup inserts atomically with normalized fields and a secure HTTP-only cookie', async () => {
  let inserted;
  const deps = dependencies({ insertUser: async input => { inserted = input; return account; } });
  const res = await handleSignup(request('signup', { ...signup, email: ' Person@Example.Invalid ' }), deps);
  assert.equal(res.status, 201);
  assert.deepEqual(inserted, { name: signup.name, gender: null, email: account.email, passwordHash: 'hashed' });
  const cookie = res.headers.get('set-cookie');
  for (const value of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=604800']) assert.ok(cookie.includes(value));
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(JSON.stringify(await res.json()).includes('hashed'), false);
});

test('duplicate signup and database errors return safe failures without creating a session', async () => {
  const duplicate = await handleSignup(request('signup'), dependencies({ insertUser: async () => undefined }));
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.headers.get('set-cookie'), null);
  const broken = await handleLogin(request('login', { email: account.email, password: 'old' }), dependencies({
    findUser: async () => { throw new Error('private-database-error-details'); },
  }));
  assert.equal(broken.status, 503);
  assert.equal((await broken.text()).includes('private-'), false);
});

test('login denies unknown and wrong-password accounts with the same response and compares both', async () => {
  const replies = [];
  for (const user of [undefined, { ...account, password_hash: 'stored-hash' }]) {
    let compared = false;
    const res = await handleLogin(request('login', { email: 'PERSON@example.invalid', password: 'old' }), dependencies({
      findUser: async email => { assert.equal(email, account.email); return user; },
      comparePassword: async (_, hash) => { compared = true; assert.ok(hash); return false; },
    }));
    assert.equal(compared, true);
    assert.equal(res.status, 401);
    replies.push(await res.text());
  }
  assert.equal(replies[0], replies[1]);
});

test('legacy passwords over 72 bytes retain bcrypt login compatibility but cannot create new accounts', async () => {
  const password = `${'legacy-prefix-'.repeat(6)}original-suffix`;
  assert.ok(new TextEncoder().encode(password).length > 72);
  const passwordHash = await bcrypt.hash(password, 12);
  const deps = dependencies({
    findUser: async () => ({ ...account, password_hash: passwordHash }),
    comparePassword: undefined,
  });
  const login = await handleLogin(request('login', { email: account.email, password }), deps);
  assert.equal(login.status, 200);
  const newAccount = await handleSignup(request('signup', { ...signup, password }), deps);
  assert.equal(newAccount.status, 400);
  assert.equal(validateCredentials({ email: account.email, password: 'x'.repeat(1024) }, false).password.length, 1024);
  assert.throws(() => validateCredentials({ email: account.email, password: 'x'.repeat(1025) }, false), /1024/);
});

test('rate limiting blocks hashing and account lookups and returns Retry-After', async () => {
  const deps = dependencies({
    consumeLimit: async () => 120,
    hashPassword: () => { throw new Error('must not hash'); },
    findUser: () => { throw new Error('must not look up'); },
  });
  for (const [handler, req] of [[handleSignup, request('signup')],
    [handleLogin, request('login', { email: account.email, password: 'old' })]]) {
    const res = await handler(req, deps);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '120');
  }
});

test('me returns only the account identity, handles deleted users and hides database failures', async () => {
  const req = new Request('https://app.example.invalid/api/auth/me', { headers: { Cookie: 'other=x; session=token' } });
  assert.deepEqual(await (await handleMe(req, dependencies())).json(), { user: account });
  const deleted = await handleMe(req, dependencies({ getUser: async () => undefined }));
  assert.equal(deleted.status, 401);
  assert.match(deleted.headers.get('set-cookie'), /Max-Age=0/);
  const anonymous = await handleMe(new Request(req.url), dependencies({ getUser: () => { throw new Error('no'); } }));
  assert.equal(anonymous.status, 401);
  const down = await handleMe(req, dependencies({ getUser: async () => { throw new Error('private detail'); } }));
  assert.equal(down.status, 503);
  assert.equal((await down.text()).includes('private detail'), false);
});

test('logout expires the secure cookie without requiring database availability', () => {
  const res = handleLogout(request('logout'), dependencies());
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /session=;.*HttpOnly;.*Max-Age=0; Secure/);
});

test('repository uses a single shared transaction and HMAC keys rather than raw emails or client IPs', async () => {
  const queries = [];
  const sql = (strings, ...values) => { const query = { text: strings.join('?'), values }; queries.push(query); return query; };
  let transactionCount = 0;
  sql.transaction = async all => {
    transactionCount++;
    assert.equal(all.length, 3);
    return [[], [{ attempts: 1, retry_after: 59 }], [{ attempts: 11, retry_after: 899 }]];
  };
  const repository = createAuthRepository(sql, new Uint8Array(32).fill(1));
  assert.equal(await repository.consumeLimit('login', account.email), 899);
  assert.equal(transactionCount, 1);
  assert.equal(JSON.stringify(queries).includes(account.email), false);
  assert.match(queries[1].values[0], /^[0-9a-f]{64}$/);
  assert.notEqual(queries[1].values[0], queries[2].values[0]);
  assert.match(queries[1].text, /ON CONFLICT.*DO UPDATE/s);
});
