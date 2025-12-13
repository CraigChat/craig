import { PrismaPromise } from '@prisma/client';
import axios from 'axios';
import config from 'config';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { prisma } from '../prisma';
import { TaskJob } from '../types';

interface Credentials {
  accessToken: string;
  refreshToken: string;
}

const patreonConfig = config.get('patreon') as {
  campaignId: string;
  clientId: string;
  clientSecret: string;
  tiers: { [tier: string]: number };
  skipUsers: string[];
};

export default class RefreshPatrons extends TaskJob {
  constructor() {
    super('refreshPatrons', '0 * * * *');
  }

  async getCredentials() {
    const credentials = JSON.parse(await readFile(join(__dirname, '../../config/.patreon-credentials.json'), 'utf-8')) as Credentials;

    // Test if access token is valid
    const { status } = await axios.get('https://www.patreon.com/api/oauth2/v2/identity', {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`
      },
      validateStatus: () => true
    });

    if (status !== 200) {
      const { data } = await axios.post(
        'https://www.patreon.com/api/oauth2/token?' +
          new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: credentials.refreshToken,
            client_id: patreonConfig.clientId,
            client_secret: patreonConfig.clientSecret
          }).toString()
      );

      this.logger.info('Refreshing Patreon access token');

      credentials.accessToken = data.access_token;
      credentials.refreshToken = data.refresh_token;

      await writeFile(
        join(__dirname, '../../config/.patreon-credentials.json'),
        JSON.stringify({ accessToken: data.access_token, refreshToken: data.refresh_token })
      );
    }

    return credentials;
  }

  async getPatrons(credentials: Credentials, cursor?: string, retries = 0): Promise<{ patrons: Patron[]; next: string | undefined; total: number }> {
    const query = new URLSearchParams({
      include: 'currently_entitled_tiers,user',
      'fields[member]': 'full_name,currently_entitled_amount_cents,patron_status,email',
      'fields[user]': 'social_connections',
      'page[count]': '500',
      ...(cursor ? { 'page[cursor]': cursor } : {})
    });
    const response = await axios.get(`https://www.patreon.com/api/oauth2/v2/campaigns/${patreonConfig.campaignId}/members?${query}`, {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'User-Agent': this.userAgent
      },
      validateStatus: () => true
    });

    if (response.status === 429) {
      const waitFor = Math.pow(5, retries + 1);
      if (retries >= 3) throw new Error('Too many rate limit retries when fetching patrons');
      this.logger.log(`Hit a 429, waiting ${waitFor} seconds to retry...`);
      await new Promise((r) => setTimeout(r, waitFor * 1000));
      return this.getPatrons(credentials, cursor, retries + 1);
    } else if (response.status !== 200) throw new Error(`Failed to fetch patrons: HTTP ${response.status}`);

    const data = response.data as PatronCampaignMembersResponse;
    const patrons = data.data.map((member) => {
      const userId = member.relationships.user.data.id;
      const user = data.included.find((i) => i.type === 'user' && i.id === userId);
      const discordId = user?.attributes.social_connections?.discord?.user_id;

      return {
        id: userId,
        entitlementId: member.id,
        name: member.attributes.full_name,
        email: member.attributes.email,
        cents: member.attributes.currently_entitled_amount_cents,
        status: member.attributes.patron_status,
        discordId,
        tiers: member.relationships.currently_entitled_tiers.data.map((tier) => tier.id)
      } as Patron;
    });

    return {
      patrons,
      next: data.meta.pagination.cursors?.next,
      total: data.meta.pagination.total
    };
  }

  determineRewardTier(patron: Patron) {
    return patron.tiers.map((t) => patreonConfig.tiers[t] || 0).sort((a, b) => b - a)[0] || 0;
  }

  async collectPatrons() {
    this.logger.log('Collecting patrons...');

    const credentials = await this.getCredentials();
    const initialData = await this.getPatrons(credentials);

    if (initialData.total === 0) return [];

    this.logger.info(`Fetching ${initialData.total.toLocaleString()} patrons...`);
    const start = Date.now();

    const patrons = initialData.patrons;
    let nextCursor = initialData.next;
    if (initialData.next)
      while (patrons.length < initialData.total) {
        const nextData = await this.getPatrons(credentials, nextCursor);
        let newPatrons = 0;
        for (const patron of nextData.patrons) {
          if (!patrons.find((p) => p.id === patron.id)) {
            patrons.push(patron);
            newPatrons++;
          }
        }
        this.logger.log(
          `Got ${newPatrons} more patrons (${patrons.length}/${initialData.total}, ${((patrons.length / initialData.total) * 100).toFixed(2)}%), ${
            nextData.next ? `fetching next page from cursor ${nextData.next}...` : 'no cursor found.'
          }`
        );
        if (!nextData.next) break;
        nextCursor = nextData.next;
      }

    this.logger.info(
      `Collected ${patrons.length} patrons in ${(Date.now() - start) / 1000}s. (${patrons
        .filter((p) => p.status === 'active_patron')
        .length.toLocaleString()} active, ${patrons.filter((p) => !!p.discordId).length.toLocaleString()} with discord, ${patrons
        .filter((p) => !!p.discordId && p.status === 'active_patron')
        .length.toLocaleString()} active with discord)`
    );

    return patrons;
  }

  resolveUserEntitlement(entitlements: { tier: number }[], userId: string) {
    const maxTier = entitlements.some((e) => e.tier === -1) ? -1 : entitlements.reduce((max, e) => Math.max(max, e.tier), 0);

    return prisma.user.update({
      where: { id: userId },
      data: {
        rewardTier: maxTier,
        ...(maxTier === 0 ? { driveEnabled: false } : {})
      }
    });
  }

  async run() {
    const patrons = await this.collectPatrons();
    if (patrons.length === 0) return void this.logger.info('No patrons found.');

    const operations: PrismaPromise<any>[] = [];
    const now = new Date();

    const activePatronIds = new Set<string>();
    const affectedUserIds = new Set<string>();

    for (const patron of patrons.filter((p) => p.status === 'active_patron')) {
      const { id: patreonId, name, email, cents, tiers, discordId } = patron;

      activePatronIds.add(patreonId);

      // Upsert into Patreon table
      operations.push(
        prisma.patreon.upsert({
          where: { id: patreonId },
          update: { name, email, cents, tiers, updatedAt: now },
          create: { id: patreonId, name, email, cents, tiers }
        })
      );

      let resolvedDiscordId = discordId;

      if (!resolvedDiscordId) {
        const user = await prisma.user.findFirst({
          where: { patronId: patreonId }
        });
        if (user) resolvedDiscordId = user.id;
      }

      if (!resolvedDiscordId) continue;

      affectedUserIds.add(resolvedDiscordId);

      // Unlink any users who have this patronId but are not the resolved user
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

      // Upsert the resolved user
      operations.push(
        prisma.user.upsert({
          where: { id: resolvedDiscordId },
          update: { patronId: patreonId },
          create: { id: resolvedDiscordId, patronId: patreonId }
        })
      );

      // Set their entitlement
      const tier = this.determineRewardTier(patron);
      operations.push(
        prisma.entitlement.upsert({
          where: {
            userId_source: {
              userId: resolvedDiscordId,
              source: 'patreon'
            }
          },
          update: {
            tier,
            expiresAt: null,
            sourceEntitlementId: patron.entitlementId
          },
          create: {
            userId: resolvedDiscordId,
            source: 'patreon',
            tier,
            sourceEntitlementId: patron.entitlementId
          }
        })
      );
    }

    this.logger.info(`Committing ${operations.length.toLocaleString()} pateron/entitlement/user changes...`);
    await prisma.$transaction(operations);

    // Remove old Patreon entitlements
    this.logger.info('Checking for stale entitlements...');
    const staleEntitlements = await prisma.entitlement.findMany({
      where: { source: 'patreon' },
      select: { userId: true, user: { select: { patronId: true } } }
    });

    for (const { userId, user } of staleEntitlements) {
      if (!user?.patronId || !activePatronIds.has(user.patronId)) {
        await prisma.entitlement.deleteMany({
          where: { userId, source: 'patreon' }
        });
        affectedUserIds.add(userId);
      }
    }

    this.logger.info(`Re-evaluating ${affectedUserIds.size.toLocaleString()} users...`);
    const entitlements = await prisma.entitlement.findMany({
      where: {
        userId: { in: [...affectedUserIds] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
      },
      select: {
        userId: true,
        tier: true,
        source: true
      }
    });
    await prisma.$transaction(
      Array.from(affectedUserIds).map((userId) =>
        this.resolveUserEntitlement(
          entitlements.filter((e) => e.userId === userId),
          userId
        )
      )
    );
    this.logger.info('OK.');
  }
}

type PatronStatus = 'declined_patron' | 'active_patron' | 'former_patron';

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

interface PatronMember {
  attributes: {
    currently_entitled_amount_cents: number;
    email: string;
    full_name: string;
    patron_status: PatronStatus;
  };
  id: string;
  relationships: {
    currently_entitled_tiers: {
      data: [
        {
          id: string;
          type: 'tier';
        }
      ];
    };
    user: {
      data: {
        id: string;
        type: 'user';
      };
      links: {
        related: string;
      };
    };
  };
  type: string;
}

interface PatronUserAttributes {
  attributes: {
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

interface PatronCampaignMembersResponse {
  data: PatronMember[];
  included: PatronUserAttributes[];
  links?: {
    next?: string;
  };
  meta: {
    pagination: {
      cursors?: {
        next?: string;
      };
      total: number;
    };
  };
}
