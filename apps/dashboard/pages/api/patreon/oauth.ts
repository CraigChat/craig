import { NextApiRequest, NextApiResponse } from 'next';
import fetch from 'node-fetch';

import prisma from '../../../lib/prisma';
import { parseUser } from '../../../utils';
import { config } from '../../../utils/config';
import { PatreonUser } from '../../../utils/types';

const REDIRECT_URI = `${config.appUri}/api/patreon/oauth`;

const OAUTH_QS = new URLSearchParams({
  client_id: config.patreonClientId,
  redirect_uri: REDIRECT_URI,
  response_type: 'code'
}).toString();

const OAUTH_URI = `https://www.patreon.com/oauth2/authorize?${OAUTH_QS}`;

export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') return res.redirect('/');
  const user = parseUser(req);
  if (!user) return res.redirect('/');

  const { code = null, error = null } = req.query;
  if (error) return res.redirect(`/?error=${req.query.error}&from=patreon`);

  if (!code || typeof code !== 'string') return res.redirect(OAUTH_URI);

  const body = new URLSearchParams({
    client_id: config.patreonClientId,
    client_secret: config.patreonClientSecret,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
    code
  }).toString();

  const { access_token = null, token_type = 'Bearer' } = await fetch('https://www.patreon.com/api/oauth2/token', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
    body
  }).then((res) => res.json());

  if (!access_token || typeof access_token !== 'string')
    return res.redirect(`/?error=${encodeURIComponent('Could not get an access token, please sign in again.')}&from=patreon`);

  const me: PatreonUser = await fetch('https://www.patreon.com/api/oauth2/v2/identity', {
    headers: { Authorization: `${token_type} ${access_token}` }
  }).then((res) => res.json());

  if (!('data' in me)) return res.redirect(`/?error=${encodeURIComponent('Could not get user data, please sign in again.')}&from=patreon`);

  const otherUser = await prisma.user.findFirst({ where: { patronId: me.data.id } });
  if (otherUser) await prisma.user.update({ where: { id: otherUser.id }, data: { patronId: null } });

  await prisma.user.upsert({
    where: { id: user.id },
    update: { patronId: me.data.id },
    create: { id: user.id, patronId: me.data.id }
  });

  res.redirect('/?r=patreon_linked');
};
