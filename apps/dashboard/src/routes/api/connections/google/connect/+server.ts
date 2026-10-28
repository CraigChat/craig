import { getRewardTier } from '@craig/db';
import { redirect } from '@sveltejs/kit';

import { googleScopes } from '#lib/oauth.js';
import { checkAuth } from '#lib/server/discord.js';
import { SESSION_COOKIE } from '#lib/server/jwt.js';
import { toRedirectUri } from '#lib/server/oauth.js';
import { generateOAuthState, rateLimitRequest } from '#lib/server/redis.js';
import { GOOGLE_CLIENT_SECRET } from '$app/env/private';
import { PUBLIC_GOOGLE_CLIENT_ID } from '$app/env/public';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, getClientAddress }) => {
  if (!PUBLIC_GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return redirect(307, '/?error=__NO_ACCESS_TOKEN&from=google');

  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'connect-google-url', limit: 20, window: 60 });
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get(SESSION_COOKIE);
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return redirect(307, '/login');
  if ((await getRewardTier(auth.id)) === 0) return redirect(307, '/');

  const state = await generateOAuthState(auth.id);
  const params = new URLSearchParams({
    access_type: 'offline',
    prompt: 'consent',
    scope: googleScopes.join(' '),
    response_type: 'code',
    client_id: PUBLIC_GOOGLE_CLIENT_ID,
    redirect_uri: toRedirectUri('google'),
    state
  });

  return redirect(307, `https://accounts.google.com/o/oauth2/v2/auth?${params}`, { external: true });
};
