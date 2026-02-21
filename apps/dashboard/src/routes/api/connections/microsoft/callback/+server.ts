import { env } from '$env/dynamic/private';
import { env as envPub } from '$env/dynamic/public';
import { checkAuth } from '$lib/server/discord';
import { rateLimitRequest, validateOAuthState } from '$lib/server/redis';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { microsoftScopes, toRedirectUri } from '$lib/oauth';
import { prisma } from '@craig/db';

export interface MicrosoftOAuthResponse {
  token_type: string;
  scope: string;
  expires_in: number;
  ext_expires_in: number;
  access_token: string;
  refresh_token: string;
  id_token: string;
}

export interface MicrosoftUser {
  displayName: string;
  userPrincipalName: string;
}

export const GET: RequestHandler = async ({ cookies, getClientAddress, url }) => {
  if (!envPub.PUBLIC_MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) return redirect(307, '/?error=__NO_ACCESS_TOKEN&from=microsoft');

  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'connect-microsoft', limit: 5, window: 60 });
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get('session');
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return redirect(307, '/login');
  const user = await prisma.user.findUnique({ where: { id: auth.id } });
  if (!user || user.rewardTier === 0) return redirect(307, '/');

  const error = url.searchParams.get('error');
  if (error) return redirect(307, `/?error=${encodeURIComponent(error)}&from=microsoft`);
  const state = url.searchParams.get('state');
  if (!state || !(await validateOAuthState(state, auth.id))) return redirect(307, '/?error=__INVALID_STATE&from=microsoft');
  const code = url.searchParams.get('code');
  if (!code || typeof code !== 'string') return redirect(307, '/');

  try {
    const body = new URLSearchParams({
      client_id: envPub.PUBLIC_MICROSOFT_CLIENT_ID,
      client_secret: env.MICROSOFT_CLIENT_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: toRedirectUri('microsoft'),
      code
    }).toString();

    const response: MicrosoftOAuthResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
      body
    }).then((res) => res.json());

    if (!response.access_token || typeof response.access_token !== 'string') return redirect(307, `/?error=__NO_ACCESS_TOKEN&from=microsoft`);
    if (!response.refresh_token || typeof response.refresh_token !== 'string') return redirect(307, `/?error=__NO_ACCESS_TOKEN&from=microsoft`);
    const scopesRecieved = response.scope.split(' ');
    if (microsoftScopes.find((s) => s !== 'offline_access' && !scopesRecieved.includes(s)))
      return redirect(307, `/?error=__INVALID_SCOPE&from=microsoft`);

    const me: MicrosoftUser = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `${response.token_type} ${response.access_token}` }
    }).then((res) => res.json());

    if (!('displayName' in me) || !('userPrincipalName' in me)) return redirect(307, `/?error=__NO_USER_DATA&from=microsoft`);

    await prisma.microsoftUser.upsert({
      where: { id: user.id },
      update: { token: response.access_token, refreshToken: response.refresh_token, name: me.displayName, username: me.userPrincipalName },
      create: {
        id: user.id,
        token: response.access_token,
        refreshToken: response.refresh_token,
        name: me.displayName,
        username: me.userPrincipalName
      }
    });
  } catch (e) {
    console.error('Failed to get Microsoft info', e);
    return redirect(307, '/?error=__NO_USER_DATA&from=microsoft');
  }

  await prisma.user.upsert({
    where: { id: user.id },
    update: { driveService: 'onedrive' },
    create: { id: user.id, driveService: 'onedrive' }
  });

  return redirect(307, '/?r=account_linked&from=microsoft');
};
