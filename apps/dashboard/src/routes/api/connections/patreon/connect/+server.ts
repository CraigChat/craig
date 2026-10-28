import { redirect } from '@sveltejs/kit';

import { toRedirectUri } from '#lib/oauth.js';
import { checkAuth } from '#lib/server/discord.js';
import { SESSION_COOKIE } from '#lib/server/jwt.js';
import { generateOAuthState, rateLimitRequest } from '#lib/server/redis.js';
import { PUBLIC_PATREON_CLIENT_ID } from '$app/env/public';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, getClientAddress }) => {
  if (!PUBLIC_PATREON_CLIENT_ID) return redirect(307, '/?error=__NO_ACCESS_TOKEN&from=patreon');

  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'connect-patreon-url', limit: 20, window: 60 });
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get(SESSION_COOKIE);
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return redirect(307, '/login');

  const state = await generateOAuthState(auth.id);
  const params = new URLSearchParams({
    client_id: PUBLIC_PATREON_CLIENT_ID,
    redirect_uri: toRedirectUri('patreon'),
    response_type: 'code',
    state
  });

  return redirect(307, `https://www.patreon.com/oauth2/authorize?${params}`, { external: true });
};
