import { prisma } from '@craig/db';
import { redirect } from '@sveltejs/kit';
import jwt from 'jsonwebtoken';

import { env } from '$env/dynamic/private';
import { env as envPub } from '$env/dynamic/public';
import { googleScopes } from '$lib/oauth';
import { checkAuth } from '$lib/server/discord';
import { logger } from '$lib/server/logger';
import { googleOAuth2Client } from '$lib/server/oauth';
import { rateLimitRequest, validateOAuthState } from '$lib/server/redis';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, getClientAddress, url }) => {
  if (!envPub.PUBLIC_GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return redirect(307, '/?error=__NO_ACCESS_TOKEN&from=google');

  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'connect-google', limit: 5, window: 60 });
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get('session');
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return redirect(307, '/login');
  const user = await prisma.user.findUnique({ where: { id: auth.id } });
  if (!user || user.rewardTier === 0) return redirect(307, '/');

  const error = url.searchParams.get('error');
  if (error) return redirect(307, `/?error=${encodeURIComponent(error)}&from=google`);
  const state = url.searchParams.get('state');
  if (!state) {
    logger.warn(`OAuth connection rejected: missing state (user=${auth.id}, service=google)`);
    return redirect(307, '/?error=__INVALID_STATE&from=google');
  }
  const isStateValid = await validateOAuthState(state, auth.id);
  if (!isStateValid) {
    logger.warn(`OAuth connection rejected: invalid state (user=${auth.id}, service=google, state=${state})`);
    return redirect(307, '/?error=__INVALID_STATE&from=google');
  }
  const code = url.searchParams.get('code');
  if (!code || typeof code !== 'string') return redirect(307, '/');

  try {
    const { tokens } = await googleOAuth2Client.getToken(code);
    if (!('access_token' in tokens)) return redirect(307, `/?error=__NO_ACCESS_TOKEN&from=google`);
    if (tokens.scope!.split(' ').sort().join(' ') !== googleScopes.sort().join(' ')) return redirect(307, '/?error=__INVALID_SCOPE&from=google');

    let serviceUserId = 'unknown';
    if (tokens.id_token) {
      const decoded = jwt.decode(tokens.id_token);
      if (decoded && typeof decoded === 'object' && 'sub' in decoded && typeof decoded.sub === 'string') {
        serviceUserId = decoded.sub;
      }
    }

    if (serviceUserId === 'unknown') {
      const about = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      }).then((res) => res.json());
      const permissionId = about?.user?.permissionId;
      const emailAddress = about?.user?.emailAddress;
      if (typeof permissionId === 'string') serviceUserId = permissionId;
      else if (typeof emailAddress === 'string') serviceUserId = emailAddress;
    }

    logger.info(`OAuth connection established (user=${user.id}, service=google, serviceUserId=${serviceUserId})`);

    await prisma.googleDriveUser.upsert({
      where: { id: user.id },
      update: { token: tokens.access_token!, refreshToken: tokens.refresh_token },
      create: { id: user.id, token: tokens.access_token!, refreshToken: tokens.refresh_token }
    });
  } catch (e) {
    console.error('Failed to get Google info', e);
    return redirect(307, '/?error=__NO_USER_DATA&from=google');
  }

  await prisma.user.upsert({
    where: { id: user.id },
    update: { driveService: 'google' },
    create: { id: user.id, driveService: 'google' }
  });

  return redirect(307, '/?r=account_linked&from=google');
};
