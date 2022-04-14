import { NextApiRequest, NextApiResponse } from 'next';

import prisma from '../../../lib/prisma';
import { parseUser } from '../../../utils';

export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') return res.redirect('/');
  const user = parseUser(req);
  if (!user) return res.redirect('/');

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  await prisma.user.upsert({
    where: { id: user.id },
    update: { patronId: null, rewardTier: dbUser?.rewardTier === -1 ? dbUser?.rewardTier : 0 },
    create: { id: user.id, patronId: null }
  });

  const googleDrive = await prisma.googleDriveUser.findUnique({ where: { id: user.id } });
  if (googleDrive)
    await prisma.googleDriveUser.update({
      where: { id: user.id },
      data: { enabled: false }
    });

  res.redirect('/?r=patreon_unlinked');
};
