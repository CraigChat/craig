import { env } from '$env/dynamic/private';
import { env as envPub } from '$env/dynamic/public';
import { checkAuth } from '$lib/server/discord';
import { rateLimitRequest } from '$lib/server/redis';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PATREON_REDIRECT_URI } from '$lib/oauth';
import { prisma } from '@craig/db';
import { determineRewardTier, resolveUserEntitlement, type PatreonIdentifyResponse } from '$lib/server/patreon';

export const GET: RequestHandler = async ({ cookies, getClientAddress, url }) => {
  if (!envPub.PUBLIC_PATREON_CLIENT_ID || !env.PATREON_CLIENT_SECRET) return redirect(307, '/?error=__NO_ACCESS_TOKEN&from=patreon');

  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'connect-patreon', limit: 5, window: 60 });
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get('session');
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return redirect(307, '/login');

  const error = url.searchParams.get('error');
  if (error) return redirect(307, `/?error=${error}&from=patreon`);
  const code = url.searchParams.get('code');
  if (!code || typeof code !== 'string') return redirect(307, '/');

  const body = new URLSearchParams({
    client_id: envPub.PUBLIC_PATREON_CLIENT_ID,
    client_secret: env.PATREON_CLIENT_SECRET,
    grant_type: 'authorization_code',
    redirect_uri: PATREON_REDIRECT_URI,
    code
  }).toString();

  // Exchange code
  const { access_token = null, token_type = 'Bearer' } = await fetch('https://www.patreon.com/api/oauth2/token', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
    body
  }).then((res) => res.json());

  if (!access_token || typeof access_token !== 'string') return redirect(307, '/?error=__NO_ACCESS_TOKEN&from=patreon');

  // Fetch Patreon user
  const me: PatreonIdentifyResponse = await fetch(
    'https://www.patreon.com/api/oauth2/v2/identity?fields[user]=social_connections,full_name,email&include=memberships',
    {
      headers: { Authorization: `${token_type} ${access_token}` }
    }
  ).then((res) => res.json());
  if (!('data' in me)) return redirect(307, '/?error=__NO_USER_DATA&from=patreon');

  console.log(`User ${auth.id} connected patreon user ${me.data.id}`, me);

  const otherUser = await prisma.user.findFirst({ where: { patronId: me.data.id } });
  if (otherUser && otherUser.id !== auth.id) await prisma.user.update({ where: { id: otherUser.id }, data: { patronId: null } });

  // Update patron status
  const membership = me.included.find((i) => i.type === 'member');
  if (membership?.attributes.patron_status === 'active_patron') {
    const linkedDiscordId = me.data?.attributes.social_connections?.discord?.user_id;
    if (linkedDiscordId && auth.id !== linkedDiscordId) return redirect(307, '/?error=__USER_ID_MISMATCH&from=patreon');

    const patron = await prisma.patreon.upsert({
      where: { id: me.data.id },
      update: {
        name: me.data.attributes.full_name ?? membership.attributes.full_name ?? '',
        email: me.data.attributes.email ?? membership.attributes.email ?? '',
        cents: membership.attributes.currently_entitled_amount_cents
      },
      create: {
        id: me.data.id,
        name: me.data.attributes.full_name ?? membership.attributes.full_name ?? '',
        email: me.data.attributes.email ?? membership.attributes.email ?? '',
        cents: membership.attributes.currently_entitled_amount_cents
      }
    });

    const patreonTier = determineRewardTier(patron.tiers);
    if (patreonTier !== 0)
      await prisma.entitlement.upsert({
        where: {
          userId_source: {
            userId: auth.id,
            source: 'patreon'
          }
        },
        create: {
          userId: auth.id,
          source: 'patreon',
          tier: patreonTier,
          sourceEntitlementId: membership.id
        },
        update: {
          tier: patreonTier,
          sourceEntitlementId: membership.id
        }
      });

    await prisma.user.upsert({
      where: { id: auth.id },
      update: { patronId: me.data.id },
      create: { id: auth.id, patronId: me.data.id }
    });
    await resolveUserEntitlement(auth.id);
  } else
    await prisma.user.upsert({
      where: { id: auth.id },
      update: { patronId: me.data.id },
      create: { id: auth.id, patronId: me.data.id }
    });

  return redirect(307, '/?r=account_linked&from=patreon');
};
