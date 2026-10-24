import { db, type DbClient, rewardTierUpdate } from '@craig/db';

import { env } from '$env/dynamic/private';

const tierMap: { [tier: string]: number } = JSON.parse(env.PATREON_TIER_MAP ?? '{}');
export const determineRewardTier = (tiers: string[]) => tiers.map((t) => tierMap[t] || 0).sort((a, b) => b - a)[0] || 0;

export async function resolveUserEntitlement(userId: string, patronId?: string | null, client: DbClient = db) {
  await client
    .updateTable('User')
    .set((eb) => ({
      ...rewardTierUpdate(eb),
      ...(patronId !== undefined ? { patronId } : {})
    }))
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
    last_charge_date: string | null;
    last_charge_status: string | null;
    lifetime_support_cents: number;
    currently_entitled_amount_cents: number;
    next_charge_date: string | null;
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
