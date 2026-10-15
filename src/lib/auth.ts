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
    });
    if (!Number.isSafeInteger(payload.userId) || (payload.userId as number) <= 0 ||
        typeof payload.email !== 'string' || !payload.email) {
      return null;
    }
    return payload as { userId: number; email: string };
  } catch {
    return null;
  }
}
