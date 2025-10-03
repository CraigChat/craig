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

export const determineRewardTier = (tiers: string[]) => tiers.map((t) => tierMap[t] || 0).sort((a, b) => b - a)[0] || 0;

async function resolveUserEntitlement(userId: string, patronId?: string | null) {
  const entitlements = await prisma.entitlement.findMany({
    where: {
      userId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    },
    select: { tier: true }
  });
  const maxTier = entitlements.some((e) => e.tier === -1) ? -1 : entitlements.reduce((max, e) => Math.max(max, e.tier), 0);

  return prisma.user.update({
    where: { id: userId },
    data: {
      rewardTier: maxTier,
      ...(maxTier === 0 ? { driveEnabled: false } : {}),
      ...(patronId !== undefined ? { patronId } : {})
    }
  });
}

const formatPatron = (body: any) => {
  const id = body.data.relationships.user?.data?.id;
  if (!id) return null;
  const user = body.included.find((i: any) => i.type === 'user' && i.id === id);

  return {
    id,
    name: body.data.attributes.full_name,
    email: body.data.attributes.email || user?.attributes?.email,
    cents: body.data.attributes.currently_entitled_amount_cents,
    tiers: body.data.relationships.currently_entitled_tiers?.data.map((tier: { id: string }) => tier.id) || [],
    discordId: user?.attributes?.social_connections?.discord?.user_id
  } as { id: string; name: string; email: string; cents?: number; tiers: string[]; discordId?: string };
};

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
  if (!patron) return res.status(400).send('No patron ID found');
  const dbPatron = await prisma.patreon.findUnique({ where: { id: patron.id } });
  console.info(new Date().toISOString(), `New event: ${event} (${patron.id}, ${patron.name} - ${patron.email})`);
  res.status(200).send('OK');

  // Handle event
  if (event === 'members:pledge:delete') {
    console.info(new Date().toISOString(), `Deleted patron ${patron.id}`);
    const user = await prisma.user.findFirst({ where: { patronId: patron.id } });
    if (user && user.rewardTier > 0) {
      await prisma.entitlement.delete({ where: { userId_source: { userId: user.id, source: 'patreon' } } }).catch(() => {});
      console.info(new Date().toISOString(), `Re-evaluating rewards for user ${user.id}`);
      await resolveUserEntitlement(user.id);
    }
  } else if (event === 'members:pledge:create' || event === 'members:pledge:update') {
    const patron = formatPatron(body);
    if (!patron.tiers.length || !patron.cents) return;

    if (
      !dbPatron ||
      dbPatron.name !== patron.name ||
      dbPatron.email !== patron.email ||
      dbPatron.cents !== patron.cents ||
      dbPatron.tiers !== patron.tiers
    ) {
      console.info(new Date().toISOString(), `Upserting patron ${patron.id} (${patron.name} - ${patron.email})`);
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

    if (patron.discordId) {
      const user = await prisma.user.findFirst({ where: { patronId: patron.id } });
      if (user && user.id !== patron.discordId) {
        console.info(new Date().toISOString(), `Removing patronage for ${user.id} due to clashing with ${patron.discordId} (${patron.id})`);
        // await prisma.user.update({ where: { id: user.id }, data: { patronId: undefined, rewardTier: 0, driveEnabled: false } });
        await prisma.entitlement.delete({ where: { userId_source: { userId: user.id, source: 'patreon' } } }).catch(() => {});
        await resolveUserEntitlement(user.id, null);
      }
    }

    const userId = patron.discordId ?? (await prisma.user.findFirst({ where: { patronId: patron.id } }))?.id;
    if (!userId) return;

    const tier = determineRewardTier(patron.tiers);
    if (tier !== 0) {
      await prisma.entitlement.upsert({
        where: {
          userId_source: {
            userId,
            source: 'patreon'
          }
        },
        update: {
          tier,
          expiresAt: null,
          sourceEntitlementId: body.data.id
        },
        create: {
          user: {
            connectOrCreate: {
              where: { id: userId },
              create: { id: userId, patronId: patron.id }
            }
          },
          source: 'patreon',
          tier,
          sourceEntitlementId: body.data.id
        }
      });
      console.info(new Date().toISOString(), `Re-evaluating user ${userId} for patron ${patron.id} (${patron.name}, tier=${tier})`);
      await resolveUserEntitlement(userId, patron.id);
    }
  }
};
