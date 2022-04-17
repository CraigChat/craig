import { NextApiRequest, NextApiResponse } from 'next';

import prisma from '../../../lib/prisma';
import { parseUser } from '../../../utils';

const formats = ['flac', 'aac', 'oggflac', 'heaac', 'opus', 'vorbis', 'adpcm', 'wav8'];
const containers = ['aupzip', 'zip'];

export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'PUT') return res.status(405).send({ error: 'Method not allowed' });
  const user = parseUser(req);
  if (!user) return res.status(401).send({ error: 'Unauthorized' });

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser) return res.status(404).send({ error: 'User not found' });
  if (dbUser.rewardTier === 0) return res.status(400).send({ error: 'User is not a patron' });

  const { format, container, enabled } = req.body;
  if (!formats.includes(format)) return res.status(400).send({ error: 'Invalid format' });
  if (!containers.includes(container)) return res.status(400).send({ error: 'Invalid container' });
  if (format !== 'flac' && container === 'aupzip') return res.status(400).send({ error: 'Invalid combination' });
  if (typeof enabled !== 'boolean') return res.status(400).send({ error: 'Invalid enabled state' });

  if (dbUser.driveEnabled !== enabled || dbUser.driveFormat !== format || dbUser.driveContainer !== container)
    await prisma.user.update({
      where: { id: user.id },
      data: { driveFormat: format, driveContainer: container, driveEnabled: enabled }
    });

  res.status(200).send({ ok: true });
};
