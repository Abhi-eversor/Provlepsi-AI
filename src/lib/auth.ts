import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'session';

// Validate at request time so builds do not need production credentials.
export function getSessionSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim() !== secret || new TextEncoder().encode(secret).length < 32) {
    throw new Error('JWT_SECRET must be set to a random secret of at least 32 bytes.');
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(payload: { userId: number; email: string }) {
  if (!Number.isSafeInteger(payload.userId) || payload.userId <= 0 ||
      typeof payload.email !== 'string' || !payload.email || payload.email.length > 254) {
    throw new Error('Cannot create a session for an invalid identity.');
  }
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSessionSecret());
}

export async function verifySessionToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret(), {
      algorithms: ['HS256'],
      requiredClaims: ['iat', 'exp'],
      maxTokenAge: '7d',
    });
    if (!Number.isSafeInteger(payload.userId) || (payload.userId as number) <= 0 ||
        typeof payload.email !== 'string' || !payload.email || payload.email.length > 254 ||
        typeof payload.iat !== 'number' || typeof payload.exp !== 'number' ||
        payload.exp <= payload.iat || payload.exp - payload.iat > 7 * 24 * 60 * 60) {
      return null;
    }
    return payload as { userId: number; email: string };
  } catch {
    return null;
  }
}
