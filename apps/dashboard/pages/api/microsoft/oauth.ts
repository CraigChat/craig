import { NextApiRequest, NextApiResponse } from 'next';

import prisma from '../../../lib/prisma';
import { parseUser } from '../../../utils';
import { config } from '../../../utils/config';
import { MicrosoftOAuthResponse, MicrosoftUser } from '../../../utils/types';

const REDIRECT_URI = `${config.appUri}/api/microsoft/oauth`;
const scopes = ['Files.ReadWrite.AppFolder', 'offline_access', 'openid', 'profile', 'User.Read'];

const OAUTH_URI = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${new URLSearchParams({
  client_id: config.microsoftClientId,
  scope: scopes.join(' '),
  redirect_uri: REDIRECT_URI,
  response_type: 'code'
})}`;

export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') return res.redirect('/');
  const user = parseUser(req);
  if (!user) return res.redirect('/');
  const dbUser = await prisma.user.findFirst({ where: { id: user.id } });
  if (!dbUser) return res.redirect('/');
  if (dbUser.rewardTier === 0) return res.redirect('/');

  const { code = null, error = null } = req.query;
  if (error) return res.redirect(`/?error=${req.query.error}&from=microsoft`);

  if (!code || typeof code !== 'string') return res.redirect(OAUTH_URI);

  const body = new URLSearchParams({
    client_id: config.microsoftClientId,
    client_secret: config.microsoftClientSecret,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
    code
  }).toString();

  const response: MicrosoftOAuthResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
    body
  }).then((res) => res.json());

  if (!response.access_token || typeof response.access_token !== 'string')
    return res.redirect(`/?error=${encodeURIComponent('Could not get an access token, please sign in again.')}&from=microsoft`);
  if (!response.refresh_token || typeof response.refresh_token !== 'string')
    return res.redirect(`/?error=${encodeURIComponent('Could not get a refresh token, please sign in again.')}&from=microsoft`);
  if (response.scope !== scopes.filter((s) => s !== 'offline_access').join(' ')) return res.redirect(`/?error=invalid_scope&from=microsoft`);

  const me: MicrosoftUser = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `${response.token_type} ${response.access_token}` }
  }).then((res) => res.json());

  if (!('displayName' in me) || !('userPrincipalName' in me))
    return res.redirect(`/?error=${encodeURIComponent('Could not get user data, please sign in again.')}&from=microsoft`);

  await prisma.microsoftUser.upsert({
    where: { id: user.id },
    update: { token: response.access_token, refreshToken: response.refresh_token, name: me.displayName, username: me.userPrincipalName },
    create: { id: user.id, token: response.access_token, refreshToken: response.refresh_token, name: me.displayName, username: me.userPrincipalName }
  });

  await prisma.user.upsert({
    where: { id: user.id },
    update: { driveService: 'onedrive' },
    create: { id: user.id, driveService: 'onedrive' }
  });

  res.redirect('/?r=microsoft_linked');
};
