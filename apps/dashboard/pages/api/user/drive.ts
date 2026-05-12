import { NextApiRequest, NextApiResponse } from 'next';

import prisma from '../../../lib/prisma';
import { parseUser } from '../../../utils';

const formats = ['flac', 'aac', 'oggflac', 'heaac', 'opus', 'vorbis', 'adpcm', 'wav8'];
const containers = ['aupzip', 'zip', 'mix'];
const services = ['google', 'onedrive', 'dropbox'];

function parseFormatValue(value: unknown): { format: string; container: string; value: string } | null {
  if (typeof value !== 'string') return null;
  const parts = value.split('-');
  if (parts.length !== 2) return null;
  const [format, container] = parts;
  if (!formats.includes(format)) return null;
  if (!containers.includes(container)) return null;
  if (format !== 'flac' && container === 'aupzip') return null;
  if (container === 'mix' && !['flac', 'vorbis', 'aac'].includes(format)) return null;
  return { format, container, value };
}

export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'PUT') return res.status(405).send({ error: 'Method not allowed' });
  const user = parseUser(req);
  if (!user) return res.status(401).send({ error: 'Unauthorized' });

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser) return res.status(404).send({ error: 'User not found' });

  const { enabled, service } = req.body;
  const requestedFormats = Array.isArray(req.body.formats) ? req.body.formats : [];
  const parsedFormats = requestedFormats.map(parseFormatValue);
  if (parsedFormats.some((f) => !f)) return res.status(400).send({ error: 'Invalid format' });
  if (parsedFormats.length === 0) return res.status(400).send({ error: 'Select at least one format' });
  const selectedFormats: string[] = [];
  for (const parsedFormat of parsedFormats) {
    if (!parsedFormat || selectedFormats.includes(parsedFormat.value)) continue;

    selectedFormats.push(parsedFormat.value);
  }

  if (!services.includes(service)) {
    return res.status(400).send(
      { error: 'Invalid service' });
  }

  if (typeof enabled !== 'boolean') {
    return res.status(400).send(
      { error: 'Invalid enabled state' });
  }

  if (dbUser.driveEnabled !== enabled
    || dbUser.driveService !== service
    || dbUser.driveFormats.join(',') !== selectedFormats.join(',')) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        driveFormats: selectedFormats,
        driveEnabled: enabled,
        driveService: service
      }
    });
  }

  res.status(200).send({ ok: true });
};
