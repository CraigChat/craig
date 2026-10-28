import { getRewardTier } from '@craig/db';
import { redirect } from '@sveltejs/kit';

import { checkAuth } from '#lib/server/discord.js';
import { SESSION_COOKIE } from '#lib/server/jwt.js';
import { dbxAuth, dropboxScopes, toRedirectUri } from '#lib/server/oauth.js';
import { generateOAuthState, rateLimitRequest } from '#lib/server/redis.js';
import { DROPBOX_CLIENT_SECRET } from '$app/env/private';
import { PUBLIC_DROPBOX_CLIENT_ID } from '$app/env/public';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, getClientAddress }) => {
  if (!PUBLIC_DROPBOX_CLIENT_ID || !DROPBOX_CLIENT_SECRET) return redirect(307, '/?error=__NO_ACCESS_TOKEN&from=dropbox');

  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'connect-dropbox-url', limit: 20, window: 60 });
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get(SESSION_COOKIE);
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return redirect(307, '/login');
  if ((await getRewardTier(auth.id)) === 0) return redirect(307, '/');

  const state = await generateOAuthState(auth.id);

  return redirect(
    307,
    (await dbxAuth.getAuthenticationUrl(toRedirectUri('dropbox'), state, 'code', 'offline', dropboxScopes, 'none', false)) as string,
    { external: true }
  );
};
