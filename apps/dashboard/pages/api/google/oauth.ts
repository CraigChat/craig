import { google } from 'googleapis';
import { NextApiRequest, NextApiResponse } from 'next';

import prisma from '../../../lib/prisma';
import { parseUser } from '../../../utils';
import { config } from '../../../utils/config';

const REDIRECT_URI = `${config.appUri}/api/google/oauth`;

const scopes = ['https://www.googleapis.com/auth/drive.file'];
export const oauth2Client = new google.auth.OAuth2(config.googleClientId, config.googleClientSecret, REDIRECT_URI);

const OAUTH_URI = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: scopes,
  prompt: 'consent'
});

export default async (req: NextApiRequest, res: NextApiResponse) => {
  console.log('[google-oauth] request received', {
    method: req.method,
    hasCode: typeof req.query.code === 'string',
    hasError: typeof req.query.error === 'string'
  });

  if (req.method !== 'GET') {
    console.log('[google-oauth] non-GET request, redirecting home');
    return res.redirect('/');
  }

  const user = parseUser(req);
  if (!user) {
    console.log('[google-oauth] no dashboard user cookie, redirecting home');
    return res.redirect('/');
  }

  console.log('[google-oauth] dashboard user found', { userId: user.id });

  await prisma.user.upsert({
    where: { id: user.id },
    update: {},
    create: { id: user.id }
  });
  console.log('[google-oauth] ensured user row exists', { userId: user.id });

  const { code = null, error = null } = req.query;
  if (error) {
    console.log('[google-oauth] google returned an error', { error });
    return res.redirect(`/?error=${req.query.error}&from=google`);
  }

  if (!code || typeof code !== 'string') {
    console.log('[google-oauth] no auth code, redirecting to Google consent');
    return res.redirect(OAUTH_URI);
  }

  console.log('[google-oauth] auth code received, exchanging for tokens', { userId: user.id });
  const tokenResponse = await oauth2Client.getToken(code).catch((e) => {
    console.error('[google-oauth] token exchange failed', {
      userId: user.id,
      message: e instanceof Error ? e.message : String(e)
    });
    return null;
  });
  if (!tokenResponse)
    return res.redirect(`/?error=${encodeURIComponent('Could not exchange Google authorization code, please sign in again.')}&from=google`);

  const { tokens } = tokenResponse;

  console.log('[google-oauth] token exchange completed', {
    userId: user.id,
    hasAccessToken: !!tokens.access_token,
    hasRefreshToken: !!tokens.refresh_token,
    scope: tokens.scope
  });

  if (!('access_token' in tokens))
    return res.redirect(`/?error=${encodeURIComponent('Could not get an access token, please sign in again.')}&from=google`);
  if (tokens.scope.split(' ').sort().join(' ') !== scopes.sort().join(' ')) return res.redirect('/?error=invalid_scope&from=google');

  await prisma.googleDriveUser.upsert({
    where: { id: user.id },
    update: { token: tokens.access_token, refreshToken: tokens.refresh_token },
    create: { id: user.id, token: tokens.access_token, refreshToken: tokens.refresh_token }
  });
  console.log('[google-oauth] saved Google Drive tokens', { userId: user.id, hasRefreshToken: !!tokens.refresh_token });

  await prisma.user.upsert({
    where: { id: user.id },
    update: { driveService: 'google' },
    create: { id: user.id, driveService: 'google' }
  });
  console.log('[google-oauth] selected Google Drive service', { userId: user.id });

  res.redirect('/?r=google_linked');
};
