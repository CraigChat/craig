import { Dropbox, DropboxAuth } from 'dropbox';
import { BOX_CLIENT_SECRET } from "$env/static/private";
import { PUBLIC_BOX_CLIENT_ID } from "$env/static/public";
import { checkAuth } from "$lib/server/discord";
import { rateLimitRequest } from "$lib/server/redis";
import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { prisma } from "@craig/db";

export interface BoxOAuthResponse {
  access_token: string;
  expires_in: number;
  issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  refresh_token: string;
  restricted_to?: never;
  token_type: string;
}

export interface BoxUser {
  name: string;
  id: string;
}

export const GET: RequestHandler = async ({ cookies, getClientAddress, url }) => {
  const rlResponse = await rateLimitRequest(
    { cookies, getClientAddress },
    { prefix: 'connect-box', limit: 5, window: 60 }
  );
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get('session');
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return redirect(307, '/login');
  const user = await prisma.user.findUnique({ where: { id: auth.id } });
  if (!user || user.rewardTier === 0) return redirect(307, '/');

  const error = url.searchParams.get('error');
  if (error) return redirect(307, `/?error=${error}&from=box`);
  const code = url.searchParams.get('code');
  if (!code || typeof code !== 'string') return redirect(307, '/');

  try {
    const body = new URLSearchParams({
      client_id: PUBLIC_BOX_CLIENT_ID,
      client_secret: BOX_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code'
    }).toString();

    const response: BoxOAuthResponse = await fetch('https://api.box.com/oauth2/token', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
      body
    }).then((res) => res.json());

    if (!response.access_token || typeof response.access_token !== 'string')
      return redirect(307, `/?error=__NO_ACCESS_TOKEN&from=box`);
    if (!response.refresh_token || typeof response.refresh_token !== 'string')
      return redirect(307, `/?error=__NO_ACCESS_TOKEN&from=box`);

    const me: BoxUser = await fetch('https://api.box.com/2.0/users/me', {
      headers: { Authorization: `Bearer ${response.access_token}` }
    }).then((res) => res.json());

    await prisma.boxUser.upsert({
      where: { id: user.id },
      update: { token: response.access_token, refreshToken: response.refresh_token, name: me?.name || '' },
      create: { id: user.id, token: response.access_token, refreshToken: response.refresh_token, name: me?.name || '' }
    });
  } catch (e) {
    console.error('Failed to get Box info', e);
    return redirect(307, '/?error=__NO_USER_DATA&from=box');
  }

  await prisma.user.upsert({
    where: { id: user.id },
    update: { driveService: 'box' },
    create: { id: user.id, driveService: 'box' }
  });

  return redirect(307, '/?r=account_linked&from=box');
};
