import { checkAuth } from '$lib/server/discord';
import { generateOAuthState, rateLimitRequest } from '$lib/server/redis';
import { redirect } from '@sveltejs/kit';
import { env as envPub } from '$env/dynamic/public';
import type { RequestHandler } from './$types';
import { toRedirectUri } from '$lib/oauth';

export const GET: RequestHandler = async ({ cookies, getClientAddress }) => {
  if (!envPub.PUBLIC_PATREON_CLIENT_ID) return redirect(307, '/?error=__NO_ACCESS_TOKEN&from=patreon');

  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'connect-patreon-url', limit: 20, window: 60 });
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get('session');
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return redirect(307, '/login');

  const state = await generateOAuthState(auth.id);
  const params = new URLSearchParams({
    client_id: envPub.PUBLIC_PATREON_CLIENT_ID,
    redirect_uri: toRedirectUri('patreon'),
    response_type: 'code',
    state
  });

  return redirect(307, `https://www.patreon.com/oauth2/authorize?${params}`);
};
