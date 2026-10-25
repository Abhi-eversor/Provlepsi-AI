import { createAuthRepository, getSql } from '@/lib/db';
import { createSessionToken, getSessionSecret, verifySessionToken } from '@/lib/auth';
import type { AuthDependencies } from '@/lib/auth-service';

// Lazy access keeps builds and anonymous /me independent of database credentials.
// Requests fail closed if the required schema or service is unavailable.
export function authDependencies(): AuthDependencies {
  const repository = () => createAuthRepository(getSql(), getSessionSecret());
  return {
    ensureConfigured: () => { getSessionSecret(); getSql(); },
    findUser: email => repository().findUser(email),
    insertUser: input => repository().insertUser(input),
    getUser: id => repository().getUser(id),
    consumeLimit: (action, email) => repository().consumeLimit(action, email),
    createToken: createSessionToken,
    verifyToken: verifySessionToken,
    publicOrigin: process.env.APP_ORIGIN,
    secureCookies: process.env.NODE_ENV === 'production',
  };
}
