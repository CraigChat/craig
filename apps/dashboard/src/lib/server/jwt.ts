import { jwtVerify, SignJWT } from 'jose';

const encoder = new TextEncoder();

function encodeSecret(secret: string) {
  return encoder.encode(secret);
}

export async function signSession(payload: { id: string; username: string }, secret: string) {
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('7d').sign(encodeSecret(secret));
}

export async function verifySession(token: string, secret: string) {
  const { payload } = await jwtVerify(token, encodeSecret(secret), { algorithms: ['HS256'] });
  return payload;
}
