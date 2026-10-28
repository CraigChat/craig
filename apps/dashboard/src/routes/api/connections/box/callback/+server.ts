import { db, getRewardTier } from '@craig/db';
import { isRedirect, redirect } from '@sveltejs/kit';

import { checkAuth } from '#lib/server/discord.js';
import { SESSION_COOKIE } from '#lib/server/jwt.js';
import { logger } from '#lib/server/logger.js';
import { rateLimitRequest, validateOAuthState } from '#lib/server/redis.js';
import { BOX_CLIENT_SECRET } from '$app/env/private';
import { PUBLIC_BOX_CLIENT_ID } from '$app/env/public';

import type { RequestHandler } from './$types';

export interface BoxOAuthResponse {
  access_token: string;
  expires_in: number;
  issued_token_type: 'urn:ietf:params:oauth:token-type:access_token';
  refresh_token: string;
  restricted_to?: never;
  token_type: string;
}

export interface BoxUser {
  name: string;
  id: string;
}

export const GET: RequestHandler = async ({ cookies, getClientAddress, url }) => {
  if (!PUBLIC_BOX_CLIENT_ID || !BOX_CLIENT_SECRET) return redirect(307, '/?error=__NO_ACCESS_TOKEN&from=box');

  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'connect-box', limit: 5, window: 60 });
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get(SESSION_COOKIE);
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return redirect(307, '/login');
  if ((await getRewardTier(auth.id)) === 0) return redirect(307, '/');

  const error = url.searchParams.get('error');
  if (error) return redirect(307, `/?error=${encodeURIComponent(error)}&from=box`);
  const state = url.searchParams.get('state');
  if (!state) {
    logger.warn(`OAuth connection rejected: missing state (user=${auth.id}, service=box)`);
    return redirect(307, '/?error=__INVALID_STATE&from=box');
  }
  const isStateValid = await validateOAuthState(state, auth.id);
  if (!isStateValid) {
    logger.warn(`OAuth connection rejected: invalid state (user=${auth.id}, service=box, state=${state})`);
    return redirect(307, '/?error=__INVALID_STATE&from=box');
  }
  const code = url.searchParams.get('code');
  if (!code || typeof code !== 'string') return redirect(307, '/');

  try {
    const body = new URLSearchParams({
      client_id: PUBLIC_BOX_CLIENT_ID,
      client_secret: BOX_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code'
    }).toString();

    const response: BoxOAuthResponse = await fetch('https://api.box.com/oauth2/token', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
      body
    }).then((res) => res.json());

    if (!response.access_token || typeof response.access_token !== 'string') return redirect(307, `/?error=__NO_ACCESS_TOKEN&from=box`);
    if (!response.refresh_token || typeof response.refresh_token !== 'string') return redirect(307, `/?error=__NO_ACCESS_TOKEN&from=box`);

    const me: BoxUser = await fetch('https://api.box.com/2.0/users/me', {
      headers: { Authorization: `Bearer ${response.access_token}` }
    }).then((res) => res.json());

    logger.info(`OAuth connection established (user=${auth.id}, service=box, serviceUserId=${me?.id ?? 'unknown'})`);

    const values = { token: response.access_token, refreshToken: response.refresh_token, name: me?.name || '' };
    await db
      .insertInto('BoxUser')
      .values({ id: auth.id, ...values })
      .onConflict((oc) => oc.column('id').doUpdateSet(values))
      .execute();
  } catch (e) {
    if (isRedirect(e)) throw e;
    console.error('Failed to get Box info', e);
    return redirect(307, '/?error=__NO_USER_DATA&from=box');
  }

  await db
    .insertInto('User')
    .values({ id: auth.id, driveService: 'box' })
    .onConflict((oc) => oc.column('id').doUpdateSet({ driveService: 'box' }))
    .execute();

  return redirect(307, '/?r=account_linked&from=box');
};
