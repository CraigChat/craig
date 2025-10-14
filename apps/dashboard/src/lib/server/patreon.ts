import { env } from '$env/dynamic/private';
import { prisma } from '@craig/db';

const tierMap: { [tier: string]: number } = JSON.parse(env.PATREON_TIER_MAP ?? '{}');
export const determineRewardTier = (tiers: string[]) => tiers.map((t) => tierMap[t] || 0).sort((a, b) => b - a)[0] || 0;

export async function resolveUserEntitlement(userId: string, patronId?: string | null) {
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

export interface PatreonIdentifyResponse {
  data: PatreonUser;
  included: PatreonMember[];
}

export interface PatreonWebhookBody {
  data: PatreonMember;
  included: PatreonUser[];
}
