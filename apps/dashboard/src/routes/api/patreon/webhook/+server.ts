import { createHmac, timingSafeEqual } from 'node:crypto';

import { prisma } from '@craig/db';
import { getSemaphore } from '@henrygd/semaphore';
import { json } from '@sveltejs/kit';

import { env } from '$env/dynamic/private';
import { determineRewardTier, type PatreonWebhookBody, resolveUserEntitlement } from '$lib/server/patreon';

import type { RequestHandler } from './$types';

type PatreonEvent = `members:pledge:${'create' | 'update' | 'delete'}`;

const MAX_BYTES = 1024 * 1024;

function sameTiers(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const sortedB = b.toSorted();
  return a.toSorted().every((t, i) => sortedB[i] === t);
}

async function handlePatreonEvent(event: PatreonEvent, body: PatreonWebhookBody) {
  const id = body.data.relationships.user?.data?.id;
  console.info(new Date().toISOString(), `Recieved Patreon webhook event: ${event} (${id}, ${body.data.id}, ${body.data.attributes.full_name})`);
  if (!id) return;
  const user = body.included.find((i: any) => i.type === 'user' && i.id === id);

  const patron = {
    id,
    name: body.data.attributes.full_name,
    email: body.data.attributes.email || user?.attributes?.email || '',
    cents: body.data.attributes.currently_entitled_amount_cents,
    tiers: body.data.relationships.currently_entitled_tiers?.data.map((tier: { id: string }) => tier.id) || [],
    discordId: user?.attributes?.social_connections?.discord?.user_id
  };
  const dbPatron = await prisma.patreon.findUnique({ where: { id: patron.id } });

  if (event === 'members:pledge:delete') {
    const user = await prisma.user.findFirst({ where: { patronId: patron.id }, select: { id: true } });
    console.info(new Date().toISOString(), `Deleted patron ${patron.id} (${body.data.attributes.patron_status}, user ${user?.id})`);
    if (body.data.attributes.patron_status !== 'active_patron') await prisma.patreon.delete({ where: { id: patron.id } });
    if (user) {
      if (body.data.attributes.patron_status === 'active_patron')
        await prisma.entitlement
          .update({
            where: { userId_source: { userId: user.id, source: 'patreon' } },
            data: { expiresAt: new Date(body.data.attributes.next_charge_date) }
          })
          .catch(() => {});
      else
        await prisma.entitlement
          .delete({
            where: { userId_source: { userId: user.id, source: 'patreon' } }
          })
          .catch(() => {});
      console.info(new Date().toISOString(), `Re-evaluating rewards for user ${user.id} (${body.data.attributes.patron_status})`);
      await resolveUserEntitlement(user.id);
    }
  } else if (event === 'members:pledge:create' || event === 'members:pledge:update') {
    if (!patron.tiers.length || !patron.cents) return;

    if (
      !dbPatron ||
      dbPatron.name !== patron.name ||
      dbPatron.email !== patron.email ||
      dbPatron.cents !== patron.cents ||
      !sameTiers(dbPatron.tiers, patron.tiers)
    ) {
      console.info(new Date().toISOString(), `Upserting patron ${patron.id} (${patron.name})`);
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
      const user = await prisma.user.findFirst({ where: { patronId: patron.id }, select: { id: true } });
      if (user && user.id !== patron.discordId) {
        console.info(new Date().toISOString(), `Removing patronage for ${user.id} due to clashing with ${patron.discordId} (${patron.id})`);
        await prisma.entitlement.delete({ where: { userId_source: { userId: user.id, source: 'patreon' } } }).catch(() => {});
        await resolveUserEntitlement(user.id, null);
      }
    }

    const userId = patron.discordId ?? (await prisma.user.findFirst({ where: { patronId: patron.id }, select: { id: true } }))?.id;
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
}

export const POST: RequestHandler = async ({ request }) => {
  if (!env.PATREON_WEBHOOK_SECRET) return json({ message: 'Unauthorized' }, { status: 401 });

  const event: PatreonEvent = request.headers.get('x-patreon-event') as any;
  const signature = request.headers.get('x-patreon-signature');
  if (!event || !signature || !/^[0-9a-f]{32}$/i.test(signature) || request.headers.get('user-agent') !== 'Patreon HTTP Robot')
    return json({ message: 'Unauthorized' }, { status: 401 });
  if (Number(request.headers.get('content-length')) > MAX_BYTES) return json({ message: 'Payload too large' }, { status: 413 });
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BYTES) return json({ message: 'Payload too large' }, { status: 413 });
  const hash = createHmac('md5', env.PATREON_WEBHOOK_SECRET).update(text).digest('hex');
  const hashBuffer = Buffer.from(hash);
  const signatureBuffer = Buffer.from(signature.toLowerCase());
  if (hashBuffer.length !== signatureBuffer.length || !timingSafeEqual(hashBuffer, signatureBuffer)) {
    console.log(`A Patreon webhook event (${event}) was rejected: ${hash} != ${signature} [expected]`);
    return json({ message: 'Unauthorized' }, { status: 401 });
  }
  let body: PatreonWebhookBody;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ message: 'Invalid body' }, { status: 400 });
  }

  const sem = getSemaphore(`patreon/${body.data?.relationships?.user?.data?.id ?? body.data?.id}`);
  await sem.acquire();
  try {
    await handlePatreonEvent(event, body);
  } catch (e) {
    console.error(`Failed to handle patreon event ${event}`, e);
    return json({ message: 'Failed to handle event' }, { status: 500 });
  } finally {
    sem.release();
  }

  return json({ ok: true });
};
