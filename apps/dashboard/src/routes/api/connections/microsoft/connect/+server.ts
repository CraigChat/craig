import { getRewardTier } from '@craig/db';
import { redirect } from '@sveltejs/kit';

import { microsoftScopes, toRedirectUri } from '#lib/oauth.js';
import { checkAuth } from '#lib/server/discord.js';
import { SESSION_COOKIE } from '#lib/server/jwt.js';
import { generateOAuthState, rateLimitRequest } from '#lib/server/redis.js';
import { MICROSOFT_CLIENT_SECRET } from '$app/env/private';
import { PUBLIC_MICROSOFT_CLIENT_ID } from '$app/env/public';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, getClientAddress }) => {
  if (!PUBLIC_MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET) return redirect(307, '/?error=__NO_ACCESS_TOKEN&from=microsoft');

  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'connect-microsoft-url', limit: 20, window: 60 });
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get(SESSION_COOKIE);
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return redirect(307, '/login');
  if ((await getRewardTier(auth.id)) === 0) return redirect(307, '/');

  const state = await generateOAuthState(auth.id);
  const params = new URLSearchParams({
    client_id: PUBLIC_MICROSOFT_CLIENT_ID,
    scope: microsoftScopes.join(' '),
    redirect_uri: toRedirectUri('microsoft'),
    response_type: 'code',
    state
  });

  return redirect(307, `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`, { external: true });
};
