import { NextApiRequest, NextApiResponse } from 'next';

import prisma from '../../../lib/prisma';
import { parseUser } from '../../../utils';
import { setNextAvailableService } from '../../../utils/prisma';
import { oauth2Client } from './oauth';

export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') return res.redirect('/');
  const user = parseUser(req);
  if (!user) return res.redirect('/');

  const driveData = await prisma.googleDriveUser.findUnique({ where: { id: user.id } });
  if (driveData) {
    await prisma.googleDriveUser.delete({ where: { id: user.id } });
    await oauth2Client.revokeToken(driveData.token).catch(() => {});
  }

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  await setNextAvailableService(dbUser, 'google');

  res.redirect('/?r=google_unlinked');
};
