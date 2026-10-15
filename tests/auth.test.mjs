import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { SignJWT } from 'jose';
import { createSessionToken, verifySessionToken } from '../src/lib/auth.ts';
import { getSql } from '../src/lib/db.ts';

const originalSecret = process.env.JWT_SECRET;
const originalDatabaseUrl = process.env.DATABASE_URL;
const account = { userId: 1, email: 'test@example.invalid' };

afterEach(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

function configureSecret() {
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  return new TextEncoder().encode(process.env.JWT_SECRET);
}

test('missing configuration cannot sign or accept a session', async () => {
  const key = configureSecret();
  const token = await new SignJWT(account).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('7d').sign(key);
  delete process.env.JWT_SECRET;
  await assert.rejects(createSessionToken(account), /JWT_SECRET/);
  assert.equal(await verifySessionToken(token), null);
});

test('short and whitespace-padded secrets are rejected', async () => {
  for (const secret of ['short', ' '.repeat(64), ` ${randomBytes(32).toString('hex')}`]) {
    process.env.JWT_SECRET = secret;
    await assert.rejects(createSessionToken(account), /JWT_SECRET/);
  }
});

test('configured sessions round-trip with a seven-day lifetime', async () => {
  configureSecret();
  const payload = await verifySessionToken(await createSessionToken(account));
  assert.equal(payload.userId, account.userId);
  assert.equal(payload.email, account.email);
  assert.equal(payload.exp - payload.iat, 7 * 24 * 60 * 60);
});

test('tokens signed with another key and malformed tokens are rejected', async () => {
  configureSecret();
  const token = await createSessionToken(account);
  configureSecret();
  assert.equal(await verifySessionToken(token), null);
  assert.equal(await verifySessionToken('invalid'), null);
});

test('expired tokens and tokens without expiration are rejected', async () => {
  const key = configureSecret();
  const expired = await new SignJWT(account).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) - 1).sign(key);
  const noExpiry = await new SignJWT(account).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().sign(key);
  assert.equal(await verifySessionToken(expired), null);
  assert.equal(await verifySessionToken(noExpiry), null);
});

test('unexpected signing algorithms and invalid identity claims are rejected', async () => {
  const key = configureSecret();
  const wrongAlgorithm = await new SignJWT(account).setProtectedHeader({ alg: 'HS512' })
    .setIssuedAt().setExpirationTime('7d').sign(key);
  assert.equal(await verifySessionToken(wrongAlgorithm), null);
  for (const payload of [{ userId: 0, email: account.email },
    { userId: '1', email: account.email }, { userId: 1, email: null }]) {
    const token = await new SignJWT(payload).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('7d').sign(key);
    assert.equal(await verifySessionToken(token), null);
  }
});

test('database access requires explicit configuration without making a network call', () => {
  delete process.env.DATABASE_URL;
  assert.throws(() => getSql(), /DATABASE_URL/);
});
