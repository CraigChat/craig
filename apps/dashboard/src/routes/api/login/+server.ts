import { db } from '@craig/db';
import { redirect } from '@sveltejs/kit';
import { randomBytes } from 'crypto';
import type { APIUser } from 'discord-api-types/v10';

import { SESSION_COOKIE, signSession } from '#lib/server/jwt.js';
import { rateLimitRequest, redis } from '#lib/server/redis.js';
import { sanitizePath } from '#lib/server/util.js';
import { DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI, JWT_SECRET } from '$app/env/private';
import { PUBLIC_DISCORD_CLIENT_ID } from '$app/env/public';

import type { RequestHandler } from './$types';

const OAUTH_URL = 'https://discord.com/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const USER_URL = 'https://discord.com/api/v10/users/@me';
const SCOPES = ['identify', 'guilds', 'guilds.members.read'];

export const GET: RequestHandler = async ({ url, cookies, getClientAddress }) => {
  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'login', limit: 10, window: 60 });
  if (rlResponse) return rlResponse;

  const error = url.searchParams.get('error');
  if (error)
    return new Response(null, {
      status: 307,
      headers: {
        Location: '/',
        'Cache-Control': 'no-cache'
      }
    });

  const code = url.searchParams.get('code');
  if (!code) {
    const state = randomBytes(32).toString('hex');
    const validatedNext = sanitizePath(url.searchParams.get('next'), url.origin);

    await redis.set(`oauth_state:${state}`, JSON.stringify({ next: validatedNext }), 'EX', 300);

    const params = new URLSearchParams({
      client_id: PUBLIC_DISCORD_CLIENT_ID,
      redirect_uri: DISCORD_REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES.join(' '),
      prompt: 'none',
      state
    });
    return new Response(null, {
      status: 307,
      headers: {
        Location: `${OAUTH_URL}?${params}`,
        'Cache-Control': 'no-cache'
      }
    });
  }

  const state = url.searchParams.get('state');
  if (!state) return Response.json({ error: 'Missing state' }, { status: 400 });
  const stored = await redis.get(`oauth_state:${state}`);
  if (!stored) return Response.json({ error: 'Invalid or expired state' }, { status: 400 });
  await redis.del(`oauth_state:${state}`);

  let redirectTo: string = '/';
  try {
    const parsed = JSON.parse(stored);
    const next = sanitizePath(parsed?.next, url.origin);
    if (next) redirectTo = next;
  } catch {}

  const body = new URLSearchParams({
    client_id: PUBLIC_DISCORD_CLIENT_ID,
    client_secret: DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: DISCORD_REDIRECT_URI
  });
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!tokenRes.ok) return Response.json({ error: 'Failed to get token' });
  const tokenData = await tokenRes.json();

  if (tokenData.scope.split(' ').toSorted().join(' ') !== SCOPES.toSorted().join(' ')) return Response.json({ error: 'Bad scope' }, { status: 400 });

  const userRes = await fetch(USER_URL, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` }
  });
  if (!userRes.ok) return Response.json({ error: 'Failed to get user' });
  const user: APIUser = await userRes.json();
  await redis.set(`user:${user.id}`, JSON.stringify(user), 'EX', 60 * 60);

  const tokens = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: new Date(Date.now() + tokenData.expires_in * 1000)
  };
  await db
    .insertInto('UserToken')
    .values({ id: user.id, ...tokens })
    .onConflict((oc) => oc.column('id').doUpdateSet(tokens))
    .execute();

  const token = await signSession({ id: user.id }, JWT_SECRET);
  cookies.set(SESSION_COOKIE, token, { maxAge: 60 * 60 * 24 * 7, path: '/', httpOnly: true, secure: true, sameSite: 'lax' });

  redirect(307, redirectTo);
};
