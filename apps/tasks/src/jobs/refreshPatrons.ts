import axios from 'axios';
import { TaskJob } from '../types';
import config from 'config';
import { prisma } from '../prisma';
import { PrismaPromise } from '@prisma/client';
import isEqual from 'lodash.isequal';
const patreonConfig = config.get('patreon') as {
  campaignId: string;
  accessToken: string;
  tiers: { [tier: string]: number };
  skipUsers: string[];
};

export default class RefreshPatrons extends TaskJob {
  constructor() {
    super('refreshPatrons', '0 * * * *');
  }

  async getPatrons(cursor?: string) {
    const query = new URLSearchParams({
      include: 'currently_entitled_tiers,user',
      'fields[member]': 'full_name,currently_entitled_amount_cents,patron_status,email',
      'fields[user]': 'social_connections',
      ...(cursor ? { 'page[cursor]': cursor } : {})
    });
    const response = await axios.get(
      `https://patreon.com/api/oauth2/v2/campaigns/${patreonConfig.campaignId}/members?${query}`,
      {
        headers: {
          Authorization: `Bearer ${patreonConfig.accessToken}`,
          'User-Agent': this.userAgent
        }
      }
    );

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

  async run() {
    this.logger.log('Collecting patrons...');

    const initialData = await this.getPatrons();

    if (initialData.total === 0) return void this.logger.info('No patrons found.');

    this.logger.info(`Fetching ${initialData.total.toLocaleString()} patrons...`);
    const start = Date.now();

    const patrons = initialData.patrons;
    let nextCursor = initialData.next;
    if (initialData.next)
      while (patrons.length < initialData.total) {
        const nextData = await this.getPatrons(nextCursor);
        let newPatrons = 0;
        for (const patron of nextData.patrons) {
          if (!patrons.find((p) => p.id === patron.id)) {
            patrons.push(patron);
            newPatrons++;
          }
        }
        this.logger.log(
          `Got ${newPatrons} more patrons (${patrons.length}/${initialData.total}, ${(
            (patrons.length / initialData.total) *
            100
          ).toFixed(2)}%), ${nextData.next ? `fetching next page from cursor ${nextData.next}...` : 'no cursor found.'}`
        );
        if (!nextData.next) break;
        nextCursor = nextData.next;
      }

    this.logger.info(
      `Collected ${patrons.length} patrons in ${(Date.now() - start) / 1000}s. (${patrons
        .filter((p) => p.status === 'active_patron')
        .length.toLocaleString()} active, ${patrons
        .filter((p) => !!p.discordId)
        .length.toLocaleString()} with discord, ${patrons
        .filter((p) => !!p.discordId && p.status === 'active_patron')
        .length.toLocaleString()} active with discord)`
    );

    const processedPatrons: string[] = [];
    const dbPatrons = await prisma.patreon.findMany();
    const operations: PrismaPromise<any>[] = [];

    // Remove patrons that are no longer active and update db patrons
    for (const dbPatron of dbPatrons) {
      const patron = patrons.find((p) => p.id === dbPatron.id);
      if (!patron || patron.status !== 'active_patron') {
        this.logger.log(`Removing patron ${dbPatron.id}`);
        operations.push(prisma.patreon.delete({ where: { id: dbPatron.id } }));
        processedPatrons.push(dbPatron.id);

        // Reset rewards tier
        prisma.user.findFirst();
        const user = await prisma.user.findFirst({ where: { patronId: dbPatron.id } });
        if (user && !patreonConfig.skipUsers.includes(user.id)) {
          this.logger.log(`Resetting rewards for user ${user.id}`);
          operations.push(prisma.user.update({ where: { id: user.id }, data: { rewardTier: 0 } }));
        }
      }
    }

    // Upsert patrons
    for (const patron of patrons.filter((p) => p.status === 'active_patron')) {
      if (processedPatrons.includes(patron.id)) continue;

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
      ) {
        this.logger.log(`Upserting patron ${patron.id} (${patron.name} ${patron.email})`);
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
      }

      // Upsert in user table
      if (patron.discordId && !patreonConfig.skipUsers.includes(patron.id)) {
        const user = await prisma.user.findFirst({ where: { patronId: patron.id } });
        if (user && user.id !== patron.discordId && !patreonConfig.skipUsers.includes(user.id)) {
          this.logger.log(`Removing patronage for ${user.id} due to clashing with ${patron.discordId} (${patron.id})`);
          operations.push(prisma.user.update({ where: { id: user.id }, data: { patronId: undefined, rewardTier: 0 } }));
        }

        if (patreonConfig.skipUsers.includes(patron.id)) continue;

        const tier = this.determineRewardTier(patron);
        this.logger.log(`Upserting user ${patron.discordId} for patron ${patron.id} (${patron.name}, tier=${tier})`);
        operations.push(
          prisma.user.upsert({
            where: { id: patron.discordId },
            update: { patronId: patron.id, rewardTier: tier },
            create: { id: patron.discordId, patronId: patron.id, rewardTier: tier }
          })
        );
      }
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
