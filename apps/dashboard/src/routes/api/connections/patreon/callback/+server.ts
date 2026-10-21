import { db } from '@craig/db';
import { redirect } from '@sveltejs/kit';

import { env } from '$env/dynamic/private';
import { env as envPub } from '$env/dynamic/public';
import { PATREON_REDIRECT_URI } from '$lib/oauth';
import { checkAuth } from '$lib/server/discord';
import { SESSION_COOKIE } from '$lib/server/jwt';
import { logger } from '$lib/server/logger';
import { determineRewardTier, type PatreonIdentifyResponse, resolveUserEntitlement } from '$lib/server/patreon';
import { rateLimitRequest, validateOAuthState } from '$lib/server/redis';

import type { RequestHandler } from './$types';

function upsertPatronId(userId: string, patronId: string) {
  return db
    .insertInto('User')
    .values({ id: userId, patronId })
    .onConflict((oc) => oc.column('id').doUpdateSet({ patronId }))
    .execute();
}

export const GET: RequestHandler = async ({ cookies, getClientAddress, url }) => {
  if (!envPub.PUBLIC_PATREON_CLIENT_ID || !env.PATREON_CLIENT_SECRET) return redirect(307, '/?error=__NO_ACCESS_TOKEN&from=patreon');

  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'connect-patreon', limit: 5, window: 60 });
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get(SESSION_COOKIE);
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return redirect(307, '/login');

  const error = url.searchParams.get('error');
  if (error) return redirect(307, `/?error=${encodeURIComponent(error)}&from=patreon`);
  const state = url.searchParams.get('state');
  if (!state) {
    logger.warn(`OAuth connection rejected: missing state (user=${auth.id}, service=patreon)`);
    return redirect(307, '/?error=__INVALID_STATE&from=patreon');
  }
  const isStateValid = await validateOAuthState(state, auth.id);
  if (!isStateValid) {
    logger.warn(`OAuth connection rejected: invalid state (user=${auth.id}, service=patreon, state=${state})`);
    return redirect(307, '/?error=__INVALID_STATE&from=patreon');
  }
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
    'https://www.patreon.com/api/oauth2/v2/identity?fields[user]=social_connections,full_name,email&include=memberships&fields[member]=full_name,currently_entitled_amount_cents,patron_status,email&include[member]=currently_entitled_tiers',
    {
      headers: { Authorization: `${token_type} ${access_token}` }
    }
  ).then((res) => res.json());
  if (!('data' in me)) return redirect(307, '/?error=__NO_USER_DATA&from=patreon');

  logger.info(`OAuth connection established (user=${auth.id}, service=patreon, serviceUserId=${me.data.id})`);

  const otherUser = await db.selectFrom('User').select('id').where('patronId', '=', me.data.id).executeTakeFirst();
  if (otherUser && otherUser.id !== auth.id) {
    logger.info(
      `Previous user ID from patreon being removed (user=${auth.id}, service=patreon, serviceUserId=${me.data.id}, otherUserId=${otherUser.id})`
    );
    await db.updateTable('User').set({ patronId: null }).where('id', '=', otherUser.id).execute();
  }

  // Update patron status
  const membership = me.included?.find((i) => i.type === 'member');
  if (membership?.attributes.patron_status === 'active_patron') {
    const linkedDiscordId = me.data?.attributes.social_connections?.discord?.user_id;
    if (linkedDiscordId && auth.id !== linkedDiscordId) {
      logger.warn(
        `Patreon Discord ID mismatch during connect (user=${auth.id}, service=patreon, serviceUserId=${me.data.id}, linkedDiscordId=${linkedDiscordId})`
      );
      return redirect(307, '/?error=__USER_ID_MISMATCH&from=patreon');
    }

    const name = me.data.attributes.full_name ?? membership.attributes.full_name;
    const email = me.data.attributes.email ?? membership.attributes.email;
    const cents = membership.attributes.currently_entitled_amount_cents;
    const patron = await db
      .insertInto('Patreon')
      .values({ id: me.data.id, name: name ?? '', email: email ?? '', cents })
      .onConflict((oc) => oc.column('id').doUpdateSet({ name, email, cents }))
      .returning('tiers')
      .executeTakeFirstOrThrow();

    await upsertPatronId(auth.id, me.data.id);

    const patreonTier = determineRewardTier(patron.tiers);
    if (patreonTier !== 0) {
      await db
        .insertInto('Entitlement')
        .values({ userId: auth.id, source: 'patreon', tier: patreonTier, sourceEntitlementId: membership.id })
        .onConflict((oc) => oc.columns(['userId', 'source']).doUpdateSet({ tier: patreonTier, sourceEntitlementId: membership.id }))
        .execute();
      logger.info(`Patreon tier resolved (user=${auth.id}, service=patreon, serviceUserId=${me.data.id}, tier=${patreonTier})`);
    }

    await resolveUserEntitlement(auth.id);
  } else await upsertPatronId(auth.id, me.data.id);

  return redirect(307, '/?r=account_linked&from=patreon');
};
