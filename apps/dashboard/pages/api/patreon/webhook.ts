import { createHmac } from 'crypto';
import { NextApiRequest, NextApiResponse } from 'next';

import prisma from '../../../lib/prisma';
import { config as appConfig } from '../../../utils/config';

export const config = {
  api: {
    bodyParser: false
  }
};

const tierMap: { [tier: string]: number } = JSON.parse(appConfig.patreonTierMap);

const webhookPayloadParser = (req: NextApiRequest) =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      resolve(Buffer.from(data).toString());
    });
  }) as Promise<string>;

const determineRewardTier = (tiers: string[]) => tiers.map((t) => tierMap[t] || 0).sort((a, b) => b - a)[0] || 0;
const formatPatron = (body: any) =>
  ({
    id: body.data.relationships.user?.data?.id,
    name: body.data.attributes.full_name,
    email: body.data.attributes.email,
    cents: body.data.attributes.currently_entitled_amount_cents,
    tiers: body.data.relationships.currently_entitled_tiers?.data.map((tier: { id: string }) => tier.id) || []
  } as { id: string; name: string; email: string; cents: number; tiers: string[] });

export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') return res.redirect('/');
  const { 'x-patreon-event': event, 'x-patreon-signature': signature } = req.headers;
  if (!event || !signature) return res.status(401).send('Unauthorized');
  if (req.headers['user-agent'] !== 'Patreon HTTP Robot') return res.status(401).send('Unauthorized');

  // Verify signature
  const rawBody = await webhookPayloadParser(req);
  const hash = createHmac('md5', appConfig.patreonWebhookSecret).update(rawBody).digest('hex');
  if (hash !== signature) return res.status(401).send('Unauthorized');
  const body = JSON.parse(rawBody);

  // Parse patron
  const patron = formatPatron(body);
  if (!patron.id) return res.status(400).send('No patron ID found');
  const dbPatron = await prisma.patreon.findUnique({ where: { id: patron.id } });
  console.log(new Date().toISOString(), `New event: ${event} (${patron.id}, ${patron.name}, ${patron.email})`);

  // Handle event
  if (event === 'members:pledge:delete') {
    console.log(new Date().toISOString(), `Deleted patron ${patron.id}`);
    const user = await prisma.user.findFirst({ where: { patronId: patron.id } });
    if (user && user.rewardTier > 0) {
      console.log(new Date().toISOString(), `Resetting rewards for user ${user.id}`);
      await prisma.user.update({ where: { id: user.id }, data: { rewardTier: 0, driveEnabled: false } });
    }
  } else if (event === 'members:pledge:create' || event === 'members:pledge:update') {
    const patron = formatPatron(body);
    if (!patron.tiers.length) return;

    if (
      !dbPatron ||
      dbPatron.name !== patron.name ||
      dbPatron.email !== patron.email ||
      dbPatron.cents !== patron.cents ||
      dbPatron.tiers !== patron.tiers
    ) {
      console.log(new Date().toISOString(), `Upserting patron ${patron.id} (${patron.name} - ${patron.email})`);
      await prisma.patreon.upsert({
        where: { id: patron.id },
        update: {
          name: patron.name,
          email: patron.email,
          cents: patron.cents,
          tiers: patron.tiers
        },
        create: {
          id: patron.id,
          name: patron.name,
          email: patron.email,
          cents: patron.cents,
          tiers: patron.tiers
        }
      });
    }

    const discordId: string | undefined = body.includes?.users?.find((u: any) => u.id === patron.id && u.type === 'user')?.social_connections?.discord
      ?.id;
    if (discordId) {
      const user = await prisma.user.findFirst({ where: { patronId: patron.id } });
      if (user && user.id !== discordId) {
        console.log(new Date().toISOString(), `Removing patronage for ${user.id} due to clashing with ${discordId} (${patron.id})`);
        await prisma.user.update({ where: { id: user.id }, data: { patronId: undefined, rewardTier: 0, driveEnabled: false } });
      }

      const tier = determineRewardTier(patron.tiers);
      console.log(new Date().toISOString(), `Upserting user ${discordId} for patron ${patron.id} (${patron.name}, tier=${tier})`);
      await prisma.user.upsert({
        where: { id: discordId },
        update: { patronId: patron.id, rewardTier: tier },
        create: { id: discordId, patronId: patron.id, rewardTier: tier }
      });
    }
  }

  res.status(200).send('OK');
};
