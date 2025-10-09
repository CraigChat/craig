import { Dropbox } from 'dropbox';
import { DROPBOX_CLIENT_SECRET } from "$env/static/private";
import { PUBLIC_DROPBOX_CLIENT_ID } from "$env/static/public";
import { checkAuth } from "$lib/server/discord";
import { rateLimitRequest } from "$lib/server/redis";
import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { toRedirectUri } from "$lib/oauth";
import { prisma } from "@craig/db";
import { dbxAuth, dropboxScopes } from '$lib/server/oauth';

export const GET: RequestHandler = async ({ cookies, getClientAddress, url }) => {
  const rlResponse = await rateLimitRequest(
    { cookies, getClientAddress },
    { prefix: 'connect-dropbox', limit: 5, window: 60 }
  );
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get('session');
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return redirect(307, '/login');
  const user = await prisma.user.findUnique({ where: { id: auth.id } });
  if (!user || user.rewardTier === 0) return redirect(307, '/');

  const error = url.searchParams.get('error');
  if (error) return redirect(307, `/?error=${error}&from=dropbox`);
  const code = url.searchParams.get('code');
  if (!code || typeof code !== 'string') return redirect(307, '/');

  try {
    const response = await dbxAuth.getAccessTokenFromCode(toRedirectUri('dropbox'), code);
    const tokens: { access_token: string; refresh_token: string; scope: string } = response.result as any;
    const scopesRecieved = tokens.scope.split(' ');

    if (dropboxScopes.find((s) => !scopesRecieved.includes(s))) return redirect(307, `/?error=__INVALID_SCOPE&from=dropbox`);

    const dbx = new Dropbox({
      accessToken: tokens.access_token,
      clientId: PUBLIC_DROPBOX_CLIENT_ID,
      clientSecret: DROPBOX_CLIENT_SECRET
    });

    const dropboxUser = await dbx.usersGetCurrentAccount();

    await prisma.dropboxUser.upsert({
      where: { id: user.id },
      update: { token: tokens.access_token, refreshToken: tokens.refresh_token, name: dropboxUser.result.name.display_name },
      create: { id: user.id, token: tokens.access_token, refreshToken: tokens.refresh_token, name: dropboxUser.result.name.display_name }
    });
  } catch (e) {
    console.error('Failed to get Dropbox info', e);
    return redirect(307, '/?error=__NO_USER_DATA&from=dropbox');
  }

  await prisma.user.upsert({
    where: { id: user.id },
    update: { driveService: 'dropbox' },
    create: { id: user.id, driveService: 'dropbox' }
  });

  return redirect(307, '/?r=account_linked&from=dropbox');
};
