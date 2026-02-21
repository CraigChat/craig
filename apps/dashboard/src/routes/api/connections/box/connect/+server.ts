import { checkAuth } from '$lib/server/discord';
import { generateOAuthState, rateLimitRequest } from '$lib/server/redis';
import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { env as envPub } from '$env/dynamic/public';
import type { RequestHandler } from './$types';
import { prisma } from '@craig/db';
import { boxScopes, toRedirectUri } from '$lib/oauth';

export const GET: RequestHandler = async ({ cookies, getClientAddress }) => {
  if (!envPub.PUBLIC_BOX_CLIENT_ID || !env.BOX_CLIENT_SECRET) return redirect(307, '/?error=__NO_ACCESS_TOKEN&from=box');

  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'connect-box-url', limit: 20, window: 60 });
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get('session');
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return redirect(307, '/login');
  const user = await prisma.user.findUnique({ where: { id: auth.id } });
  if (!user || user.rewardTier === 0) return redirect(307, '/');

  const state = await generateOAuthState(auth.id);
  const params = new URLSearchParams({
    client_id: envPub.PUBLIC_BOX_CLIENT_ID,
    redirect_uri: toRedirectUri('box'),
    response_type: 'code',
    scope: boxScopes.join(' '),
    state
  });

  return redirect(307, `https://account.box.com/api/oauth2/authorize?${params}`);
};
