import { jwtVerify, SignJWT } from 'jose';

export const SESSION_COOKIE = '__Host-session';

const ISSUER = 'craig-dashboard';
const AUDIENCE = 'craig-dashboard';
const MIN_SECRET_BYTES = 32;

const encoder = new TextEncoder();

export function assertJwtSecret(secret: string) {
  if (encoder.encode(secret).byteLength < MIN_SECRET_BYTES) throw new Error(`JWT_SECRET must be at least ${MIN_SECRET_BYTES} bytes.`);
}

function encodeSecret(secret: string) {
  assertJwtSecret(secret);
  return encoder.encode(secret);
}

export async function signSession(payload: { id: string }, secret: string) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(encodeSecret(secret));
}

export async function verifySession(token: string, secret: string) {
  const { payload } = await jwtVerify(token, encodeSecret(secret), { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
  return payload;
}
