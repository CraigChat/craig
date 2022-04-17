import { NextApiRequest, NextApiResponse } from 'next';

import prisma from '../../../lib/prisma';
import { parseUser } from '../../../utils';

export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') return res.redirect('/');
  const user = parseUser(req);
  if (!user) return res.redirect('/');

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (dbUser && dbUser.driveService === 'google')
    await prisma.user.update({
      where: { id: user.id },
      data: { driveEnabled: false }
    });

  await prisma.googleDriveUser.delete({
    where: { id: user.id }
  });

  res.redirect('/?r=google_unlinked');
};
