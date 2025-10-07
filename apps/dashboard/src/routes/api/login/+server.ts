import { prisma } from '@craig/db';
import { json, redirect } from '@sveltejs/kit';
import type { APIUser } from 'discord-api-types/v10';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';

import { DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI, JWT_SECRET } from '$env/static/private';
import { PUBLIC_DISCORD_CLIENT_ID } from '$env/static/public';
import { redis, rateLimitRequest } from '$lib/server/redis';

import type { RequestHandler } from './$types';
import { INVITE_PERMISSIONS_BITFIELD } from '$lib/util';

const OAUTH_URL = 'https://discord.com/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const USER_URL = 'https://discord.com/api/users/@me';
const SCOPES = ['identify', 'guilds', 'guilds.members.read'];

export const GET: RequestHandler = async ({ url, cookies, getClientAddress }) => {
  const rlResponse = await rateLimitRequest(
    { cookies, getClientAddress },
    { prefix: 'login', limit: 10, window: 60 }
  );
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
    const nextParam = url.searchParams.get('next');
    let validatedNext: string | null = null;
    if (nextParam && typeof nextParam === 'string' && nextParam.startsWith('/'))
      validatedNext = nextParam;

    await redis.set(`oauth_state:${state}`, JSON.stringify({ next: validatedNext }), 'EX', 300);

    const params = new URLSearchParams({
      client_id: PUBLIC_DISCORD_CLIENT_ID,
      redirect_uri: DISCORD_REDIRECT_URI,
      response_type: 'code',
      ...(nextParam === 'add_bot' ? {
        permissions: INVITE_PERMISSIONS_BITFIELD,
        scope: [...SCOPES, 'bot', 'applications.commands'].join(' '),
        integration_type: '0'
      } : {
        scope: SCOPES.join(' '),
        prompt: 'none'
      }),
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
  if (!state) return json({ error: 'Missing state' }, { status: 400 });
  const stored = await redis.get(`oauth_state:${state}`);
  if (!stored) return json({ error: 'Invalid or expired state' }, { status: 400 });
  await redis.del(`oauth_state:${state}`);

  let redirectTo: string = '/';
  try {
    const parsed = JSON.parse(stored);
    // const guildId = url.searchParams.get('guild_id');
    if (parsed?.next && typeof parsed.next === 'string' && parsed.next.startsWith('/'))
      redirectTo = parsed.next;
    // else if (guildId) redirectTo = `/servers/${guildId}/onboarding`;
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
  if (!tokenRes.ok) return json({ error: 'Failed to get token' });
  const tokenData = await tokenRes.json();

  if (tokenData.scope.split(' ').toSorted().join(' ') !== SCOPES.toSorted().join(' '))
    return json({ error: 'Bad scope' }, { status: 400 });

  const userRes = await fetch(USER_URL, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` }
  });
  if (!userRes.ok) return json({ error: 'Failed to get user' });
  const user: APIUser = await userRes.json();
  await redis.set(`user:${user.id}`, JSON.stringify(user), 'EX', 60 * 60);

  await prisma.userToken.upsert({
    where: { id: user.id },
    update: {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: new Date(Date.now() + tokenData.expires_in * 1000)
    },
    create: {
      id: user.id,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: new Date(Date.now() + tokenData.expires_in * 1000)
    }
  });

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  cookies.set('session', token, { maxAge: 60 * 60 * 24 * 7, path: '/' });

  redirect(307, redirectTo);
};
