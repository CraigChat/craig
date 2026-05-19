import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { type Prisma, prisma } from '@craig/db';

import {
  PATREON_CAMPAIGN_ID,
  PATREON_CLIENT_ID,
  PATREON_CLIENT_SECRET,
  PATREON_CREDENTIALS_FILE,
  PATREON_REFRESH_CRON,
  PATREON_TIER_MAP
} from '../util/config.js';
import { TaskJob } from './job.js';

interface Credentials {
  accessToken: string;
  refreshToken: string;
}

type PatronStatus = 'declined_patron' | 'active_patron' | 'former_patron' | null;

interface Patron {
  id: string;
  entitlementId: string;
  name: string;
  email: string;
  cents: number;
  status: PatronStatus;
  discordId?: string;
  tiers: string[];
}

interface PatreonMember {
  attributes: {
    currently_entitled_amount_cents: number;
    email?: string;
    full_name: string;
    patron_status: PatronStatus;
  };
  id: string;
  relationships: {
    currently_entitled_tiers?: {
      data: {
        id: string;
        type: 'tier';
      }[];
    };
    user: {
      data: {
        id: string;
        type: 'user';
      };
    };
  };
  type: 'member';
}

interface PatreonUser {
  attributes: {
    email?: string;
    social_connections?: {
      discord: null | {
        url: null;
        user_id: string;
      };
    };
  };
  id: string;
  type: 'user';
}

interface PatreonCampaignMembersResponse {
  data: PatreonMember[];
  included?: PatreonUser[];
  meta: {
    pagination: {
      cursors?: {
        next?: string;
      };
      total: number;
    };
  };
}

export class RefreshPatronsJob extends TaskJob {
  readonly userAgent = 'CraigTasks/1.0';

  constructor() {
    super('refreshPatrons', PATREON_REFRESH_CRON);
  }

  assertConfigured() {
    const missing = [
      ['PATREON_CAMPAIGN_ID', PATREON_CAMPAIGN_ID],
      ['PATREON_CLIENT_ID', PATREON_CLIENT_ID],
      ['PATREON_CLIENT_SECRET', PATREON_CLIENT_SECRET]
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missing.length) throw new Error(`Missing required Patreon config: ${missing.join(', ')}`);
  }

  async readCredentials() {
    const credentials = JSON.parse(await readFile(PATREON_CREDENTIALS_FILE, 'utf-8')) as Credentials;
    if (!credentials.accessToken || !credentials.refreshToken) throw new Error(`${PATREON_CREDENTIALS_FILE} is missing Patreon tokens.`);
    return credentials;
  }

  async writeCredentials(credentials: Credentials) {
    await mkdir(path.dirname(PATREON_CREDENTIALS_FILE), { recursive: true });
    await writeFile(PATREON_CREDENTIALS_FILE, `${JSON.stringify(credentials, null, 2)}\n`);
  }

  async getCredentials() {
    const credentials = await this.readCredentials();

    const identity = await fetch('https://www.patreon.com/api/oauth2/v2/identity', {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'User-Agent': this.userAgent
      }
    });

    if (identity.status === 200) return credentials;

    this.logger.info('Refreshing Patreon access token.');
    const response = await fetch('https://www.patreon.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.userAgent
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: credentials.refreshToken,
        client_id: PATREON_CLIENT_ID,
        client_secret: PATREON_CLIENT_SECRET
      })
    });

    if (!response.ok) throw new Error(`Failed to refresh Patreon credentials: HTTP ${response.status}`);

    const data = (await response.json()) as { access_token?: string; refresh_token?: string };
    if (!data.access_token || !data.refresh_token) throw new Error('Patreon token refresh response did not include tokens.');

    const refreshed = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token
    };
    await this.writeCredentials(refreshed);
    return refreshed;
  }

  async getPatrons(credentials: Credentials, cursor?: string, retries = 0): Promise<{ patrons: Patron[]; next?: string; total: number }> {
    const query = new URLSearchParams({
      include: 'currently_entitled_tiers,user',
      'fields[member]': 'full_name,currently_entitled_amount_cents,patron_status,email',
      'fields[user]': 'social_connections,email',
      'page[count]': '500',
      ...(cursor ? { 'page[cursor]': cursor } : {})
    });

    const response = await fetch(`https://www.patreon.com/api/oauth2/v2/campaigns/${PATREON_CAMPAIGN_ID}/members?${query}`, {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'User-Agent': this.userAgent
      }
    });

    if (response.status === 429) {
      if (retries >= 3) throw new Error('Too many rate limit retries when fetching Patreon members.');
      const waitFor = 5 ** (retries + 1);
      this.logger.warn(`Hit Patreon rate limit, waiting ${waitFor}s before retrying.`);
      await new Promise((resolve) => setTimeout(resolve, waitFor * 1000));
      return this.getPatrons(credentials, cursor, retries + 1);
    }
    if (!response.ok) throw new Error(`Failed to fetch Patreon members: HTTP ${response.status}`);

    const data = (await response.json()) as PatreonCampaignMembersResponse;
    const included = data.included ?? [];
    const patrons = data.data.map((member) => {
      const userId = member.relationships.user.data.id;
      const user = included.find((item) => item.type === 'user' && item.id === userId);

      return {
        id: userId,
        entitlementId: member.id,
        name: member.attributes.full_name,
        email: member.attributes.email || user?.attributes.email || '',
        cents: member.attributes.currently_entitled_amount_cents,
        status: member.attributes.patron_status,
        discordId: user?.attributes.social_connections?.discord?.user_id,
        tiers: member.relationships.currently_entitled_tiers?.data.map((tier) => tier.id) ?? []
      };
    });

    return {
      patrons,
      next: data.meta.pagination.cursors?.next,
      total: data.meta.pagination.total
    };
  }

  determineRewardTier(patron: Patron) {
    return patron.tiers.map((tier) => PATREON_TIER_MAP[tier] || 0).sort((a, b) => b - a)[0] || 0;
  }

  async collectPatrons() {
    this.logger.info('Collecting Patreon members.');
    const credentials = await this.getCredentials();
    const initialData = await this.getPatrons(credentials);

    if (initialData.total === 0) return [];

    const patrons = initialData.patrons;
    let nextCursor = initialData.next;
    this.logger.info(`Fetching ${initialData.total.toLocaleString()} Patreon members.`);

    while (nextCursor && patrons.length < initialData.total) {
      const nextData = await this.getPatrons(credentials, nextCursor);
      let newPatrons = 0;

      for (const patron of nextData.patrons) {
        if (patrons.some((existing) => existing.id === patron.id)) continue;
        patrons.push(patron);
        newPatrons++;
      }

      this.logger.info(`Fetched ${newPatrons.toLocaleString()} more Patreon members (${patrons.length}/${initialData.total}).`);
      nextCursor = nextData.next;
    }

    this.logger.info(
      `Collected ${patrons.length.toLocaleString()} Patreon members: ${patrons.filter((patron) => patron.status === 'active_patron').length.toLocaleString()} active, ${patrons.filter((patron) => !!patron.discordId).length.toLocaleString()} with Discord.`
    );

    return patrons;
  }

  resolveUserEntitlement(entitlements: { tier: number }[], userId: string) {
    const maxTier = entitlements.some((entitlement) => entitlement.tier === -1)
      ? -1
      : entitlements.reduce((max, entitlement) => Math.max(max, entitlement.tier), 0);

    return prisma.user.update({
      where: { id: userId },
      data: {
        rewardTier: maxTier,
        ...(maxTier === 0 ? { driveEnabled: false } : {})
      }
    });
  }

  async run() {
    this.assertConfigured();

    const patrons = await this.collectPatrons();
    if (patrons.length === 0) {
      this.logger.info('No Patreon members found.');
      return;
    }

    const operations: Prisma.PrismaPromise<unknown>[] = [];
    const now = new Date();
    const activePatronIds = new Set<string>();
    const affectedUserIds = new Set<string>();

    for (const patron of patrons.filter((item) => item.status === 'active_patron')) {
      const { id: patreonId, name, email, cents, tiers, discordId } = patron;
      activePatronIds.add(patreonId);

      operations.push(
        prisma.patreon.upsert({
          where: { id: patreonId },
          update: { name, email, cents, tiers, updatedAt: now },
          create: { id: patreonId, name, email, cents, tiers }
        })
      );

      let resolvedDiscordId = discordId;
      if (!resolvedDiscordId) {
        const user = await prisma.user.findFirst({ where: { patronId: patreonId }, select: { id: true } });
        if (user) resolvedDiscordId = user.id;
      }
      if (!resolvedDiscordId) continue;

      affectedUserIds.add(resolvedDiscordId);

      const unlinked = await prisma.user.findMany({
        where: {
          patronId: patreonId,
          id: { not: resolvedDiscordId }
        },
        select: { id: true }
      });

      if (unlinked.length > 0) {
        operations.push(
          prisma.user.updateMany({
            where: {
              patronId: patreonId,
              id: { not: resolvedDiscordId }
            },
            data: { patronId: null }
          })
        );

        for (const user of unlinked) affectedUserIds.add(user.id);
      }

      operations.push(
        prisma.user.upsert({
          where: { id: resolvedDiscordId },
          update: { patronId: patreonId },
          create: { id: resolvedDiscordId, patronId: patreonId }
        })
      );

      operations.push(
        prisma.entitlement.upsert({
          where: {
            userId_source: {
              userId: resolvedDiscordId,
              source: 'patreon'
            }
          },
          update: {
            tier: this.determineRewardTier(patron),
            expiresAt: null,
            sourceEntitlementId: patron.entitlementId
          },
          create: {
            userId: resolvedDiscordId,
            source: 'patreon',
            tier: this.determineRewardTier(patron),
            sourceEntitlementId: patron.entitlementId
          }
        })
      );
    }

    this.logger.info(`Committing ${operations.length.toLocaleString()} Patreon changes.`);
    if (operations.length > 0) await prisma.$transaction(operations);

    this.logger.info('Checking for stale Patreon entitlements.');
    const staleEntitlements = await prisma.entitlement.findMany({
      where: { source: 'patreon' },
      select: { userId: true, user: { select: { patronId: true } } }
    });

    for (const { userId, user } of staleEntitlements) {
      if (user?.patronId && activePatronIds.has(user.patronId)) continue;
      await prisma.entitlement.deleteMany({ where: { userId, source: 'patreon' } });
      affectedUserIds.add(userId);
    }

    this.logger.info(`Re-evaluating ${affectedUserIds.size.toLocaleString()} users.`);
    const entitlements = await prisma.entitlement.findMany({
      where: {
        userId: { in: [...affectedUserIds] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
      },
      select: {
        userId: true,
        tier: true
      }
    });

    await prisma.$transaction(
      [...affectedUserIds].map((userId) =>
        this.resolveUserEntitlement(
          entitlements.filter((entitlement) => entitlement.userId === userId),
          userId
        )
      )
    );
  }
}
