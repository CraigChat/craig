import { checkAuth } from '$lib/server/discord';
import { rateLimitRequest } from '$lib/server/redis';
import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { env as envPub } from '$env/dynamic/public';
import type { RequestHandler } from './$types';
import { prisma } from '@craig/db';
import { dbxAuth, dropboxScopes, toRedirectUri } from '$lib/server/oauth';

export const GET: RequestHandler = async ({ cookies, getClientAddress }) => {
  if (!envPub.PUBLIC_DROPBOX_CLIENT_ID || !env.DROPBOX_CLIENT_SECRET) return redirect(307, '/?error=__NO_ACCESS_TOKEN&from=dropbox');

  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'connect-dropbox-url', limit: 20, window: 60 });
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get('session');
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return redirect(307, '/login');
  const user = await prisma.user.findUnique({ where: { id: auth.id } });
  if (!user || user.rewardTier === 0) return redirect(307, '/');

  return redirect(307, (await dbxAuth.getAuthenticationUrl(toRedirectUri('dropbox'), '', 'code', 'offline', dropboxScopes, 'none', false)) as string);
};
