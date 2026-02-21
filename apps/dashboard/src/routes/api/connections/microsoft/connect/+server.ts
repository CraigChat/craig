import { checkAuth } from '$lib/server/discord';
import { generateOAuthState, rateLimitRequest } from '$lib/server/redis';
import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { env as envPub } from '$env/dynamic/public';
import type { RequestHandler } from './$types';
import { prisma } from '@craig/db';
import { microsoftScopes, toRedirectUri } from '$lib/oauth';

export const GET: RequestHandler = async ({ cookies, getClientAddress }) => {
  if (!envPub.PUBLIC_MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) return redirect(307, '/?error=__NO_ACCESS_TOKEN&from=microsoft');

  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'connect-microsoft-url', limit: 20, window: 60 });
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get('session');
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return redirect(307, '/login');
  const user = await prisma.user.findUnique({ where: { id: auth.id } });
  if (!user || user.rewardTier === 0) return redirect(307, '/');

  const state = await generateOAuthState(auth.id);
  const params = new URLSearchParams({
    client_id: envPub.PUBLIC_MICROSOFT_CLIENT_ID,
    scope: microsoftScopes.join(' '),
    redirect_uri: toRedirectUri('microsoft'),
    response_type: 'code',
    state
  });

  return redirect(307, `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`);
};
