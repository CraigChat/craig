import { Dropbox, DropboxAuth } from 'dropbox';
import { NextApiRequest, NextApiResponse } from 'next';

import prisma from '../../../lib/prisma';
import { parseUser } from '../../../utils';
import { config } from '../../../utils/config';

const REDIRECT_URI = `${config.appUri}/api/dropbox/oauth`;
const scopes = ['account_info.read', 'files.content.write'];
const auth = new DropboxAuth({
  clientId: config.dropboxClientId,
  clientSecret: config.dropboxClientSecret
});

export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') return res.redirect('/');
  const user = parseUser(req);
  if (!user) return res.redirect('/');
  const dbUser = await prisma.user.findFirst({ where: { id: user.id } });
  if (!dbUser) return res.redirect('/');
  if (dbUser.rewardTier === 0) return res.redirect('/');

  const { code = null, error = null } = req.query;
  if (error) return res.redirect(`/?error=${req.query.error}&from=dropbox`);

  if (!code || typeof code !== 'string')
    return res.redirect((await auth.getAuthenticationUrl(REDIRECT_URI, null, 'code', 'offline', scopes, 'none', false)) as string);

  try {
    const response = await auth.getAccessTokenFromCode(REDIRECT_URI, code);
    const tokens: { access_token: string; refresh_token: string; scope: string } = response.result as any;
    const scopesRecieved = tokens.scope.split(' ');

    if (scopes.find((s) => !scopesRecieved.includes(s))) return res.redirect(`/?error=invalid_scope&from=dropbox`);

    const dbx = new Dropbox({
      accessToken: tokens.access_token,
      clientId: config.dropboxClientId,
      clientSecret: config.dropboxClientSecret
    });

    const dropboxUser = await dbx.usersGetCurrentAccount();

    await prisma.dropboxUser.upsert({
      where: { id: user.id },
      update: { token: tokens.access_token, refreshToken: tokens.refresh_token, name: dropboxUser.result.name.display_name },
      create: { id: user.id, token: tokens.access_token, refreshToken: tokens.refresh_token, name: dropboxUser.result.name.display_name }
    });
  } catch (e) {
    console.log(e)
    return res.redirect(`/?error=${encodeURIComponent('Could not get user data, please sign in again.')}&from=dropbox`);
  }

  await prisma.user.upsert({
    where: { id: user.id },
    update: { driveService: 'dropbox' },
    create: { id: user.id, driveService: 'dropbox' }
  });

  res.redirect('/?r=dropbox_linked');
};
