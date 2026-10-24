import { db, getRewardTier } from '@craig/db';
import { isRedirect, redirect } from '@sveltejs/kit';
import { Dropbox } from 'dropbox';

import { env } from '$env/dynamic/private';
import { env as envPub } from '$env/dynamic/public';
import { toRedirectUri } from '$lib/oauth';
import { checkAuth } from '$lib/server/discord';
import { SESSION_COOKIE } from '$lib/server/jwt';
import { logger } from '$lib/server/logger';
import { dbxAuth, dropboxScopes } from '$lib/server/oauth';
import { rateLimitRequest, validateOAuthState } from '$lib/server/redis';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, getClientAddress, url }) => {
  if (!envPub.PUBLIC_DROPBOX_CLIENT_ID || !env.DROPBOX_CLIENT_SECRET) return redirect(307, '/?error=__NO_ACCESS_TOKEN&from=dropbox');

  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'connect-dropbox', limit: 5, window: 60 });
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get(SESSION_COOKIE);
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return redirect(307, '/login');
  if ((await getRewardTier(auth.id)) === 0) return redirect(307, '/');

  const error = url.searchParams.get('error');
  if (error) return redirect(307, `/?error=${encodeURIComponent(error)}&from=dropbox`);
  const state = url.searchParams.get('state');
  if (!state) {
    logger.warn(`OAuth connection rejected: missing state (user=${auth.id}, service=dropbox)`);
    return redirect(307, '/?error=__INVALID_STATE&from=dropbox');
  }
  const isStateValid = await validateOAuthState(state, auth.id);
  if (!isStateValid) {
    logger.warn(`OAuth connection rejected: invalid state (user=${auth.id}, service=dropbox, state=${state})`);
    return redirect(307, '/?error=__INVALID_STATE&from=dropbox');
  }
  const code = url.searchParams.get('code');
  if (!code || typeof code !== 'string') return redirect(307, '/');

  try {
    const response = await dbxAuth.getAccessTokenFromCode(toRedirectUri('dropbox'), code);
    const tokens: { access_token: string; refresh_token: string; scope: string } = response.result as any;
    const scopesRecieved = tokens.scope.split(' ');

    if (dropboxScopes.find((s) => !scopesRecieved.includes(s))) return redirect(307, `/?error=__INVALID_SCOPE&from=dropbox`);

    const dbx = new Dropbox({
      accessToken: tokens.access_token,
      clientId: envPub.PUBLIC_DROPBOX_CLIENT_ID,
      clientSecret: env.DROPBOX_CLIENT_SECRET
    });

    const dropboxUser = await dbx.usersGetCurrentAccount();

    logger.info(`OAuth connection established (user=${auth.id}, service=dropbox, serviceUserId=${dropboxUser.result.account_id})`);

    const values = { token: tokens.access_token, refreshToken: tokens.refresh_token, name: dropboxUser.result.name.display_name };
    await db
      .insertInto('DropboxUser')
      .values({ id: auth.id, ...values })
      .onConflict((oc) => oc.column('id').doUpdateSet(values))
      .execute();
  } catch (e) {
    if (isRedirect(e)) throw e;
    console.error('Failed to get Dropbox info', e);
    return redirect(307, '/?error=__NO_USER_DATA&from=dropbox');
  }

  await db
    .insertInto('User')
    .values({ id: auth.id, driveService: 'dropbox' })
    .onConflict((oc) => oc.column('id').doUpdateSet({ driveService: 'dropbox' }))
    .execute();

  return redirect(307, '/?r=account_linked&from=dropbox');
};
