import { PrismaPromise, User } from '@prisma/client';
import axios from 'axios';
import config from 'config';
import isEqual from 'lodash.isequal';
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

  async collectFromPatreon() {
    this.logger.log('Collecting patrons...');

    const credentials = await this.getCredentials();
    const initialData = await this.getPatrons(credentials);

    if (initialData.total === 0) {
      this.logger.info('No patrons found.');
      return [];
    }

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

  async run() {
    this.logger.log('Running benefit management task...');

    const patrons = await this.collectFromPatreon();
    if (patrons.length === 0) return;

    const operations: PrismaPromise<any>[] = [];

    const processedPatrons = new Set<string>();
    const dbPatrons = await prisma.patreon.findMany();
    type Action = { t: 'reset_patreon' } | { t: 'set'; tier: number; for: 'patreon'; patreonId?: string };
    const userActions = new Map<string, Action[]>();
    const users = new Map<string, User>();
    const addAction = (userId: string, action: Action) => userActions.set(userId, [action, ...(userActions.get(userId) ?? [])]);
    const shouldSkipProcessing = (user: User) => !patreonConfig.skipUsers.includes(user.id) || !user.tierManuallySet || user.rewardTier === -1;
    const getUser = async (userId: string) => users.get(userId) || (await prisma.user.findFirst({ where: { id: userId } }));

    // Remove patrons that are no longer active and update db patrons
    for (const dbPatron of dbPatrons) {
      const patron = patrons.find((p) => p.id === dbPatron.id);
      if (!patron || patron.status !== 'active_patron') {
        this.logger.log(`Removing patron ${dbPatron.id}`);
        operations.push(prisma.patreon.delete({ where: { id: dbPatron.id } }));
        processedPatrons.add(dbPatron.id);

        // Reset rewards tier
        const user = await prisma.user.findFirst({ where: { patronId: dbPatron.id } });
        if (user) users.set(user.id, user);
        if (user && !shouldSkipProcessing(user)) {
          this.logger.log(`Resetting rewards for user ${user.id}`);
          addAction(user.id, { t: 'set', tier: 0, for: 'patreon' });
          operations.push(prisma.user.update({ where: { id: user.id }, data: { rewardTier: 0, driveEnabled: false } }));
        }
      }
    }

    // Upsert patrons
    for (const patron of patrons.filter((p) => p.status === 'active_patron')) {
      if (processedPatrons.has(patron.id)) continue;

      // Upsert in patreon table
      const dbPatron = dbPatrons.find((p) => p.id === patron.id);
      if (
        !dbPatron ||
        !isEqual(
          {
            name: patron.name,
            email: patron.email,
            cents: patron.cents,
            tiers: patron.tiers
          },
          {
            name: dbPatron.name,
            email: dbPatron.email,
            cents: dbPatron.cents,
            tiers: dbPatron.tiers
          }
        )
      )
        operations.push(
          prisma.patreon.upsert({
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
          })
        );

      if (patreonConfig.skipUsers.includes(patron.id)) {
        this.logger.log(`Skipping patron ${patron.id}...`);
        continue;
      }

      // Upsert in user table
      if (patron.discordId) {
        const user = await prisma.user.findFirst({ where: { patronId: patron.id } });
        if (user) users.set(user.id, user);
        if (user && user.id !== patron.discordId && !shouldSkipProcessing(user)) {
          this.logger.info(`Removing patronage for ${user.id} due to clashing with ${patron.discordId} (${patron.id})`);
          addAction(user.id, { t: 'reset_patreon' });
        }

        const tier = this.determineRewardTier(patron);
        if (!patreonConfig.skipUsers.includes(patron.discordId))
          addAction(patron.discordId, { t: 'set', tier, for: 'patreon', patreonId: patron.id });
      } else if (!patreonConfig.skipUsers.includes(patron.id)) {
        // Find if this person is a patron, and give them a tier if so
        const user = await prisma.user.findFirst({ where: { patronId: patron.id } });
        if (user) users.set(user.id, user);
        if (!user || shouldSkipProcessing(user)) continue;
        const tier = this.determineRewardTier(patron);
        addAction(user.id, { t: 'set', tier, for: 'patreon' });
      }
    }

    for (const [userId, actions] of userActions.entries()) {
      const patronId = actions.find((a) => a.t === 'reset_patreon')
        ? null
        : (actions.find((a) => a.t === 'set' && a.patreonId) as { patreonId?: string })?.patreonId;
      const bestTierAction = actions.filter((a) => a.t === 'set').sort((a, b) => b.tier - a.tier)[0];
      const tier = bestTierAction?.tier || 0;
      const user = await getUser(userId);
      if (user?.rewardTier === tier && (!patronId || patronId === user?.patronId)) continue;
      this.logger.log(`Updating user ${userId} reward tier to ${tier} from ${bestTierAction.for}`);
      operations.push(
        prisma.user.upsert({
          where: { id: userId },
          update: {
            rewardTier: tier,
            ...(patronId !== undefined ? { patronId } : {}),
            ...(tier === 0 ? { driveEnabled: false } : {})
          },
          create: {
            id: userId,
            rewardTier: tier,
            ...(patronId !== undefined ? { patronId } : {})
          }
        })
      );
    }

    this.logger.info(`Committing ${operations.length.toLocaleString()} changes...`);
    await prisma.$transaction(operations);
    this.logger.info('OK.');
  }
}

type PatronStatus = 'declined_patron' | 'active_patron' | 'former_patron';

interface Patron {
  id: string;
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
