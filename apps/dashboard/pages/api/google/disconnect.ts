import { NextApiRequest, NextApiResponse } from 'next';
import { parseUser } from '../../../utils';
import prisma from '../../../lib/prisma';

export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') return res.redirect('/');
  const user = parseUser(req);
  if (!user) return res.redirect('/');

  await prisma.googleDriveUser.delete({
    where: { id: user.id }
  });

  res.redirect('/?r=google_unlinked');
};
