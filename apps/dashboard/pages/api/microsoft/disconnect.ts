import { NextApiRequest, NextApiResponse } from 'next';

import prisma from '../../../lib/prisma';
import { parseUser } from '../../../utils';
import { setNextAvailableService } from '../../../utils/prisma';

export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') return res.redirect('/');
  const user = parseUser(req);
  if (!user) return res.redirect('/');

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  await setNextAvailableService(dbUser, 'onedrive');

  await prisma.microsoftUser.delete({ where: { id: user.id } });

  res.redirect('/?r=microsoft_unlinked');
};
