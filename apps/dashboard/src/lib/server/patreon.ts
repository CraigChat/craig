import { db } from '@craig/db';

import { env } from '$env/dynamic/private';

const tierMap: { [tier: string]: number } = JSON.parse(env.PATREON_TIER_MAP ?? '{}');
export const determineRewardTier = (tiers: string[]) => tiers.map((t) => tierMap[t] || 0).sort((a, b) => b - a)[0] || 0;

export async function resolveUserEntitlement(userId: string, patronId?: string | null) {
  const entitlements = await db
    .selectFrom('Entitlement')
    .select('tier')
    .where('userId', '=', userId)
    .where((eb) => eb.or([eb('expiresAt', 'is', null), eb('expiresAt', '>', new Date())]))
    .execute();
  const maxTier = entitlements.some((e) => e.tier === -1) ? -1 : entitlements.reduce((max, e) => Math.max(max, e.tier), 0);

  await db
    .updateTable('User')
    .set({
      rewardTier: maxTier,
      ...(maxTier === 0 ? { driveEnabled: false } : {}),
      ...(patronId !== undefined ? { patronId } : {})
    })
    .where('id', '=', userId)
    .execute();
}

export interface PatreonUser {
  id: string;
  type: 'user';
  attributes: {
    full_name: string;
    email?: string;
    social_connections: {
      discord: {
        user_id: string;
      } | null;
    };
  };
}

export interface PatreonMember {
  attributes: {
    full_name: string;
    email?: string;
    is_follower: false;
    last_charge_date: string;
    last_charge_status: string;
    lifetime_support_cents: number;
    currently_entitled_amount_cents: number;
    next_charge_date: string;
    pledge_relationship_start: string;
    patron_status: 'active_patron' | 'declined_patron' | 'former_patron' | null;
  };
  id: string;
  relationships: {
    currently_entitled_tiers: {
      data: {
        id: string;
        type: 'tier';
      }[];
    };
    user?: {
      data: {
        id: string;
        type: 'user';
      };
    };
  };
  type: 'member';
}

// Patreon omits `included` when there is nothing to include (e.g. no memberships)
export interface PatreonIdentifyResponse {
  data: PatreonUser;
  included?: PatreonMember[];
}

export interface PatreonWebhookBody {
  data: PatreonMember;
  included?: PatreonUser[];
}
