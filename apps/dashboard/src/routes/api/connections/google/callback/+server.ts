import { db, getRewardTier } from '@craig/db';
import { isRedirect, redirect } from '@sveltejs/kit';
import { decodeJwt } from 'jose';

import { env } from '$env/dynamic/private';
import { env as envPub } from '$env/dynamic/public';
import { googleScopes } from '$lib/oauth';
import { checkAuth } from '$lib/server/discord';
import { SESSION_COOKIE } from '$lib/server/jwt';
import { logger } from '$lib/server/logger';
import { googleOAuth2Client } from '$lib/server/oauth';
import { rateLimitRequest, validateOAuthState } from '$lib/server/redis';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, getClientAddress, url }) => {
  if (!envPub.PUBLIC_GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return redirect(307, '/?error=__NO_ACCESS_TOKEN&from=google');

  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'connect-google', limit: 5, window: 60 });
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get(SESSION_COOKIE);
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return redirect(307, '/login');
  if ((await getRewardTier(auth.id)) === 0) return redirect(307, '/');

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
    if (!tokens.access_token || !tokens.refresh_token) return redirect(307, `/?error=__NO_ACCESS_TOKEN&from=google`);
    if (tokens.scope!.split(' ').sort().join(' ') !== googleScopes.sort().join(' ')) return redirect(307, '/?error=__INVALID_SCOPE&from=google');

    let serviceUserId = 'unknown';
    if (tokens.id_token) {
      try {
        const decoded = decodeJwt(tokens.id_token);
        if (typeof decoded.sub === 'string') serviceUserId = decoded.sub;
      } catch {}
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

    logger.info(`OAuth connection established (user=${auth.id}, service=google, serviceUserId=${serviceUserId})`);

    const values = { token: tokens.access_token, refreshToken: tokens.refresh_token };
    await db
      .insertInto('GoogleDriveUser')
      .values({ id: auth.id, ...values })
      .onConflict((oc) => oc.column('id').doUpdateSet(values))
      .execute();
  } catch (e) {
    if (isRedirect(e)) throw e;
    console.error('Failed to get Google info', e);
    return redirect(307, '/?error=__NO_USER_DATA&from=google');
  }

  await db
    .insertInto('User')
    .values({ id: auth.id, driveService: 'google' })
    .onConflict((oc) => oc.column('id').doUpdateSet({ driveService: 'google' }))
    .execute();

  return redirect(307, '/?r=account_linked&from=google');
};
