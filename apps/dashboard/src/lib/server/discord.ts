import { prisma, type UserToken } from '@craig/db';
import { getSemaphore } from '@henrygd/semaphore';
import type { APIUser } from 'discord-api-types/v10';
import jwt from 'jsonwebtoken';

import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

import { requiredEnv } from './env';
import { cacheData } from './redis';

export async function checkAndRefreshTokens(userTokens: UserToken) {
  const publicDiscordClientID = requiredEnv('PUBLIC_DISCORD_CLIENT_ID', publicEnv.PUBLIC_DISCORD_CLIENT_ID);
  const discordClientSecret = requiredEnv('DISCORD_CLIENT_SECRET', env.DISCORD_CLIENT_SECRET);
  const discordRedirectURI = requiredEnv('DISCORD_REDIRECT_URI', env.DISCORD_REDIRECT_URI);

  let accessToken = userTokens.accessToken;
  if (userTokens.expiresAt < new Date()) {
    const body = new URLSearchParams({
      client_id: publicDiscordClientID,
      client_secret: discordClientSecret,
      grant_type: 'refresh_token',
      refresh_token: userTokens.refreshToken,
      redirect_uri: discordRedirectURI
    });
    const res = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!res.ok) {
      await prisma.userToken.delete({ where: { id: userTokens.id } });
      return null;
    }
    const data = await res.json();
    accessToken = data.access_token;
    await prisma.userToken.update({
      where: { id: userTokens.id },
      data: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000)
      }
    });
  }

  return accessToken;
}

export async function validateAuth(token: string | null) {
  if (!token) return null;

  const jwtSecret = requiredEnv('JWT_SECRET', env.JWT_SECRET);
  let payload: any;
  try {
    payload = jwt.verify(token, jwtSecret);
  } catch {
    return null;
  }

  const sem = getSemaphore(`validateAuth/${payload.id}`);
  await sem.acquire();
  try {
    const userToken = await prisma.userToken.findUnique({ where: { id: payload.id } });
    if (!userToken) return null;

    const accessToken = await checkAndRefreshTokens(userToken);
    if (!accessToken) return null;

    return { id: payload.id as string, accessToken };
  } finally {
    sem.release();
  }
}

export async function checkAuth(token: string | null) {
  const auth = await validateAuth(token);
  if (!auth) return null;

  const user = await getUser(auth.id, `Bearer ${auth.accessToken}`);
  if (!user) return null;

  return { ...auth, user };
}

export async function getUser(userId: string, token?: string) {
  return cacheData(
    {
      key: `user:${userId}`,
      ttl: 60 * 60
    },
    async () => {
      if (token) {
        const response = await fetch('https://discord.com/api/v10/users/@me', {
          headers: { Authorization: token }
        });
        if (response.ok) {
          const user: APIUser = await response.json();
          if (user?.id === userId) return user;
        }
      } else throw new Error('No token');
    }
  );
}
