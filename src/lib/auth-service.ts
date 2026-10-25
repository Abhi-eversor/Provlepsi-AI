import bcrypt from 'bcryptjs';

export type Account = { id: number; name: string; email: string };
export type LoginAccount = Account & { password_hash: string };
export type SignupInput = { name: string; gender: string | null; email: string; password: string };
export type AuthDependencies = {
  ensureConfigured: () => void;
  findUser: (email: string) => Promise<LoginAccount | undefined>;
  insertUser: (input: Omit<SignupInput, 'password'> & { passwordHash: string }) => Promise<Account | undefined>;
  getUser: (id: number) => Promise<Account | undefined>;
  consumeLimit: (action: 'login' | 'signup', email: string) => Promise<number | null>;
  createToken: (account: { userId: number; email: string }) => Promise<string>;
  verifyToken: (token: string) => Promise<{ userId: number; email: string } | null>;
  hashPassword?: (password: string) => Promise<string>;
  comparePassword?: (password: string, hash: string) => Promise<boolean>;
  publicOrigin?: string;
  secureCookies: boolean;
};

const MAX_BODY_BYTES = 4096;
const SESSION_AGE_SECONDS = 7 * 24 * 60 * 60;
// Fixed dummy hash keeps an unknown account on the password-comparison path.
const DUMMY_PASSWORD_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.4kUOUnZV7xfE1cEeLYx6KJ7ZbmFnrXK';

class InputError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

function rejectForeignOrigin(request: Request, configuredOrigin?: string) {
  const expected = configuredOrigin ? new URL(configuredOrigin) : new URL(request.url);
  if (!['http:', 'https:'].includes(expected.protocol) || expected.username || expected.password ||
      (configuredOrigin && configuredOrigin !== expected.origin)) {
    throw new Error('APP_ORIGIN must be an HTTP(S) origin without a path.');
  }
  if (request.headers.get('origin') !== expected.origin ||
      request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new InputError('This request must originate from this application.', 403);
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new InputError('Content-Type must be application/json.', 415);
  }
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new InputError('Request body exceeds 4096 bytes.', 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new InputError('A JSON object is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new InputError('Request body exceeds 4096 bytes.', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new InputError('Request body must contain valid UTF-8 JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('A JSON object is required.');
  return body as Record<string, unknown>;
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') throw new InputError('A valid email address is required.');
  const email = value.trim().toLowerCase();
  const [local, domain, extra] = email.split('@');
  if (email.length > 254 || !local || local.length > 64 || !domain || extra !== undefined ||
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || local.startsWith('.') ||
      local.endsWith('.') || local.includes('..') || domain.length > 253 ||
      !domain.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) {
    throw new InputError('A valid email address is required.');
  }
  return email;
}

export function validateCredentials(body: Record<string, unknown>, signup: boolean) {
  const allowed = signup ? ['name', 'gender', 'email', 'password'] : ['email', 'password'];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new InputError('Unexpected request fields.');
  const email = normalizeEmail(body.email);
  const password = body.password;
  // Older accounts could be created with >72-byte passwords. bcrypt silently
  // truncated those inputs; accept bounded original inputs when signing in so
  // those users can still authenticate. Never create new truncated passwords.
  const maximumPasswordBytes = signup ? 72 : 1024;
  if (typeof password !== 'string' || password.includes('\0') ||
      Array.from(password).length < (signup ? 12 : 1) || new TextEncoder().encode(password).length > maximumPasswordBytes) {
    throw new InputError(signup
      ? 'Password must contain at least 12 characters and at most 72 UTF-8 bytes.'
      : 'Password must contain between 1 and 1024 UTF-8 bytes.');
  }
  if (!signup) return { email, password };
  if (typeof body.name !== 'string') throw new InputError('Name must contain 1 to 100 characters.');
  const name = body.name.trim();
  if (!name || Array.from(name).length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new InputError('Name must contain 1 to 100 characters without control characters.');
  }
  if (body.gender !== undefined && body.gender !== null &&
      (typeof body.gender !== 'string' || body.gender.length > 50 || /[\u0000-\u001f\u007f]/.test(body.gender))) {
    throw new InputError('Gender must be a string of at most 50 characters.');
  }
  return { name, gender: typeof body.gender === 'string' ? body.gender.trim() || null : null, email, password };
}

function sessionCookie(token: string, secure: boolean, expired = false) {
  return `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expired ? 0 : SESSION_AGE_SECONDS}${secure ? '; Secure' : ''}`;
}

function failure(error: unknown) {
  if (error instanceof InputError) return json({ error: error.message }, error.status);
  // Do not return SQL errors, connection strings, or configuration details to clients.
  return json({ error: 'Authentication service is unavailable. Please try again later.' }, 503);
}

export async function handleLogin(request: Request, dependencies: AuthDependencies) {
  try {
    rejectForeignOrigin(request, dependencies.publicOrigin);
    const { email, password } = validateCredentials(await readJson(request), false);
    dependencies.ensureConfigured();
    const retry = await dependencies.consumeLimit('login', email);
    if (retry !== null) return json({ error: 'Too many attempts. Please try again later.' }, 429, { 'Retry-After': String(retry) });
    const user = await dependencies.findUser(email);
    const valid = await (dependencies.comparePassword ?? bcrypt.compare)(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!user || !valid) return json({ error: 'Invalid email or password.' }, 401);
    const token = await dependencies.createToken({ userId: user.id, email: user.email });
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token, dependencies.secureCookies) });
  } catch (error) { return failure(error); }
}

export async function handleSignup(request: Request, dependencies: AuthDependencies) {
  try {
    rejectForeignOrigin(request, dependencies.publicOrigin);
    const input = validateCredentials(await readJson(request), true) as SignupInput;
    dependencies.ensureConfigured();
    const retry = await dependencies.consumeLimit('signup', input.email);
    if (retry !== null) return json({ error: 'Too many attempts. Please try again later.' }, 429, { 'Retry-After': String(retry) });
    const passwordHash = await (dependencies.hashPassword ?? (password => bcrypt.hash(password, 12)))(input.password);
    const user = await dependencies.insertUser({ name: input.name, gender: input.gender, email: input.email, passwordHash });
    if (!user) return json({ error: 'Unable to create this account. Try signing in or use a different email.' }, 409);
    const token = await dependencies.createToken({ userId: user.id, email: user.email });
    return json({ ok: true }, 201, { 'Set-Cookie': sessionCookie(token, dependencies.secureCookies) });
  } catch (error) { return failure(error); }
}

export async function handleMe(request: Request, dependencies: AuthDependencies) {
  try {
    const token = request.headers.get('cookie')?.split(';').map(part => part.trim())
      .find(part => part.startsWith('session='))?.slice('session='.length);
    const session = token ? await dependencies.verifyToken(token) : null;
    if (!session) return json({ user: null }, 401);
    const user = await dependencies.getUser(session.userId);
    if (!user) return json({ user: null }, 401, { 'Set-Cookie': sessionCookie('', dependencies.secureCookies, true) });
    return json({ user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) { return failure(error); }
}

export function handleLogout(request: Request, dependencies: Pick<AuthDependencies, 'publicOrigin' | 'secureCookies'>) {
  try {
    rejectForeignOrigin(request, dependencies.publicOrigin);
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', dependencies.secureCookies, true) });
  } catch (error) { return failure(error); }
}
