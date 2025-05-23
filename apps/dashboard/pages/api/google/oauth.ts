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
  if (req.method !== 'GET') return res.redirect('/');
  const user = parseUser(req);
  if (!user) return res.redirect('/');
  const dbUser = await prisma.user.findFirst({ where: { id: user.id } });
  if (!dbUser) return res.redirect('/');
  if (dbUser.rewardTier === 0) return res.redirect('/');

  const { code = null, error = null } = req.query;
  if (error) return res.redirect(`/?error=${req.query.error}&from=google`);

  if (!code || typeof code !== 'string') return res.redirect(OAUTH_URI);

  const { tokens } = await oauth2Client.getToken(code);
  if (!('access_token' in tokens))
    return res.redirect(`/?error=${encodeURIComponent('Could not get an access token, please sign in again.')}&from=google`);
  if (tokens.scope.split(' ').sort().join(' ') !== scopes.sort().join(' ')) return res.redirect('/?error=invalid_scope&from=google');

  await prisma.googleDriveUser.upsert({
    where: { id: user.id },
    update: { token: tokens.access_token, refreshToken: tokens.refresh_token },
    create: { id: user.id, token: tokens.access_token, refreshToken: tokens.refresh_token }
  });

  await prisma.user.upsert({
    where: { id: user.id },
    update: { driveService: 'google' },
    create: { id: user.id, driveService: 'google' }
  });

  res.redirect('/?r=google_linked');
};
