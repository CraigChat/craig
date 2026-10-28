import { db, getRewardTier } from '@craig/db';
import { isRedirect, redirect } from '@sveltejs/kit';

import { microsoftScopes, toRedirectUri } from '#lib/oauth.js';
import { checkAuth } from '#lib/server/discord.js';
import { SESSION_COOKIE } from '#lib/server/jwt.js';
import { logger } from '#lib/server/logger.js';
import { rateLimitRequest, validateOAuthState } from '#lib/server/redis.js';
import { MICROSOFT_CLIENT_SECRET } from '$app/env/private';
import { PUBLIC_MICROSOFT_CLIENT_ID } from '$app/env/public';

import type { RequestHandler } from './$types';

export interface MicrosoftOAuthResponse {
  token_type: string;
  scope: string;
  expires_in: number;
  ext_expires_in: number;
  access_token: string;
  refresh_token: string;
  id_token: string;
}

export interface MicrosoftUser {
  id: string;
  displayName: string;
  userPrincipalName: string;
}

export const GET: RequestHandler = async ({ cookies, getClientAddress, url }) => {
  if (!PUBLIC_MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET) return redirect(307, '/?error=__NO_ACCESS_TOKEN&from=microsoft');

  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'connect-microsoft', limit: 5, window: 60 });
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get(SESSION_COOKIE);
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return redirect(307, '/login');
  if ((await getRewardTier(auth.id)) === 0) return redirect(307, '/');

  const error = url.searchParams.get('error');
  if (error) return redirect(307, `/?error=${encodeURIComponent(error)}&from=microsoft`);
  const state = url.searchParams.get('state');
  if (!state) {
    logger.warn(`OAuth connection rejected: missing state (user=${auth.id}, service=microsoft)`);
    return redirect(307, '/?error=__INVALID_STATE&from=microsoft');
  }
  const isStateValid = await validateOAuthState(state, auth.id);
  if (!isStateValid) {
    logger.warn(`OAuth connection rejected: invalid state (user=${auth.id}, service=microsoft, state=${state})`);
    return redirect(307, '/?error=__INVALID_STATE&from=microsoft');
  }
  const code = url.searchParams.get('code');
  if (!code || typeof code !== 'string') return redirect(307, '/');

  try {
    const body = new URLSearchParams({
      client_id: PUBLIC_MICROSOFT_CLIENT_ID,
      client_secret: MICROSOFT_CLIENT_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: toRedirectUri('microsoft'),
      code
    }).toString();

    const response: MicrosoftOAuthResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
      body
    }).then((res) => res.json());

    if ('error' in response) {
      console.error(
        `Failed to connect user ${auth.id} to Microsoft: ${'error_description' in response ? response.error_description : response.error}`
      );
      return redirect(307, `/?error=__NO_ACCESS_TOKEN&from=microsoft`);
    }

    if (!response.access_token || typeof response.access_token !== 'string') return redirect(307, `/?error=__NO_ACCESS_TOKEN&from=microsoft`);
    if (!response.refresh_token || typeof response.refresh_token !== 'string') return redirect(307, `/?error=__NO_ACCESS_TOKEN&from=microsoft`);
    const scopesRecieved = response.scope.split(' ');
    if (microsoftScopes.find((s) => s !== 'offline_access' && !scopesRecieved.includes(s)))
      return redirect(307, `/?error=__INVALID_SCOPE&from=microsoft`);

    const me: MicrosoftUser = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `${response.token_type} ${response.access_token}` }
    }).then((res) => res.json());

    if (!('displayName' in me) || !('userPrincipalName' in me)) return redirect(307, `/?error=__NO_USER_DATA&from=microsoft`);

    logger.info(`OAuth connection established (user=${auth.id}, service=microsoft, serviceUserId=${me.id})`);

    const values = { token: response.access_token, refreshToken: response.refresh_token, name: me.displayName, username: me.userPrincipalName };
    await db
      .insertInto('MicrosoftUser')
      .values({ id: auth.id, ...values })
      .onConflict((oc) => oc.column('id').doUpdateSet(values))
      .execute();
  } catch (e) {
    if (isRedirect(e)) throw e;
    console.error('Failed to get Microsoft info', e);
    return redirect(307, '/?error=__NO_USER_DATA&from=microsoft');
  }

  await db
    .insertInto('User')
    .values({ id: auth.id, driveService: 'onedrive' })
    .onConflict((oc) => oc.column('id').doUpdateSet({ driveService: 'onedrive' }))
    .execute();

  return redirect(307, '/?r=account_linked&from=microsoft');
};
