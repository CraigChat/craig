import { DexareModule } from 'dexare';
import Dysnomia from 'eris';
import { CommandContext, ComponentContext } from 'slash-create';

import type { CraigBot } from '../bot';
import { prisma } from '../prisma';

// @ts-ignore
export default class EntitlementsModule extends DexareModule<CraigBot> {
  constructor(client: any) {
    super(client, {
      name: 'entitlements',
      description: 'Entitlement management and propogation'
    });

    this.filePath = __filename;
  }

  async getCurrentUser(ctx: ComponentContext | CommandContext) {
    const userId = ctx.user.id;

    const dbEntitlement = await prisma.entitlement.findFirst({
      where: { userId, source: 'discord' }
    });

    if (ctx.entitlements.length > 0) {
      // Find highest tier entitlement from ctx
      let maxTier = 0;
      let bestEntitlement = null;
      for (const ent of ctx.entitlements) {
        const tier = this.getTierFromSKU(ent.sku_id);
        if (tier !== undefined && (bestEntitlement === null || tier > maxTier)) {
          maxTier = tier;
          bestEntitlement = ent;
        }
      }
      if (bestEntitlement && maxTier) {
        const changed =
          !dbEntitlement ||
          dbEntitlement.tier !== maxTier ||
          dbEntitlement.sourceEntitlementId !== bestEntitlement.id ||
          (dbEntitlement.expiresAt?.toISOString() || null) !== (bestEntitlement.ends_at ? new Date(bestEntitlement.ends_at).toISOString() : null);
        if (changed) {
          await prisma.entitlement.upsert({
            where: {
              userId_source: {
                userId,
                source: 'discord'
              }
            },
            create: {
              userId,
              source: 'discord',
              tier: maxTier,
              sourceEntitlementId: bestEntitlement.id,
              expiresAt: bestEntitlement.ends_at ? new Date(bestEntitlement.ends_at) : null
            },
            update: {
              tier: maxTier,
              sourceEntitlementId: bestEntitlement.id,
              expiresAt: bestEntitlement.ends_at ? new Date(bestEntitlement.ends_at) : null
            }
          });
        }
      }
    } else if (dbEntitlement)
      await prisma.entitlement.delete({
        where: {
          userId_source: {
            userId,
            source: 'discord'
          }
        }
      });

    return await this.resolveUserEntitlement(userId);
  }

  async resolveUserEntitlement(userId: string) {
    const entitlements = await prisma.entitlement.findMany({
      where: {
        userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
      },
      select: {
        tier: true
      }
    });

    const maxTier = entitlements.some((e) => e.tier === -1) ? -1 : entitlements.reduce((max, e) => Math.max(max, e.tier), 0);

    return prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        rewardTier: maxTier
      },
      update: {
        rewardTier: maxTier,
        ...(maxTier === 0 ? { driveEnabled: false } : {})
      }
    });
  }

  getTierFromSKU(sku: string) {
    const tierString = Object.entries(this.client.config.craig.rewardTiers).find(([, tier]) => tier.discordSkuId === sku)?.[0] ?? null;
    if (tierString === null) return;
    const tier = parseInt(tierString, 10);
    if (!this.client.config.craig.rewardTiers[tier]) return;
    return tier;
  }

  async onEntitlementCreate(_: any, entitlement: Dysnomia.Entitlement) {
    const tier = this.getTierFromSKU(entitlement.skuID);
    if (tier === undefined || !entitlement.userID) return;
    const testEntitlement = !entitlement.startsAt;
    await prisma.entitlement.upsert({
      where: {
        userId_source: {
          userId: entitlement.userID,
          source: 'discord'
        }
      },
      create: {
        userId: entitlement.userID,
        source: 'discord',
        tier,
        sourceEntitlementId: entitlement.id,
        expiresAt: entitlement.endsAt ? new Date(entitlement.endsAt) : null,
        ...(testEntitlement ? { note: 'Test entitlement' } : {})
      },
      update: {
        tier,
        sourceEntitlementId: entitlement.id,
        expiresAt: entitlement.endsAt ? new Date(entitlement.endsAt) : null,
        ...(testEntitlement ? { note: 'Test entitlement' } : {})
      }
    });
    await this.resolveUserEntitlement(entitlement.userID);
    if (this.client.config.craig.entitlementWebhookURLs)
      await Promise.all(
        this.client.config.craig.entitlementWebhookURLs.map((i) =>
          fetch(i.url, {
            method: 'POST',
            headers: {
              Authorization: i.key,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              event: 'ENTITLEMENT_CREATE',
              entitlement: entitlement.toJSON(),
              tier,
              clientId: this.client.bot.user.id,
              shardId: this.client.shard.id
            })
          })
        )
      ).catch(() => {});
  }

  async onEntitlementUpdate(_: any, entitlement: Dysnomia.Entitlement) {
    const tier = this.getTierFromSKU(entitlement.skuID);
    if (tier === undefined || !entitlement.userID) return;
    const testEntitlement = !entitlement.startsAt;
    await prisma.entitlement.update({
      where: {
        userId_source: {
          userId: entitlement.userID,
          source: 'discord'
        }
      },
      data: {
        tier,
        sourceEntitlementId: entitlement.id,
        expiresAt: entitlement.endsAt ? new Date(entitlement.endsAt) : null,
        ...(testEntitlement ? { note: 'Test entitlement' } : {})
      }
    });
    await this.resolveUserEntitlement(entitlement.userID);
    if (this.client.config.craig.entitlementWebhookURLs)
      await Promise.all(
        this.client.config.craig.entitlementWebhookURLs.map((i) =>
          fetch(i.url, {
            method: 'POST',
            headers: {
              Authorization: i.key,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              event: 'ENTITLEMENT_UPDATE',
              entitlement: entitlement.toJSON(),
              tier,
              clientId: this.client.bot.user.id,
              shardId: this.client.shard.id
            })
          })
        )
      ).catch(() => {});
  }

  async onEntitlementDelete(_: any, entitlement: Dysnomia.Entitlement) {
    const tier = this.getTierFromSKU(entitlement.skuID);
    if (tier === undefined || !entitlement.userID) return;
    await prisma.entitlement.delete({
      where: {
        userId_source: {
          userId: entitlement.userID,
          source: 'discord'
        }
      }
    });
    await this.resolveUserEntitlement(entitlement.userID);
    if (this.client.config.craig.entitlementWebhookURLs)
      await Promise.all(
        this.client.config.craig.entitlementWebhookURLs.map((i) =>
          fetch(i.url, {
            method: 'POST',
            headers: {
              Authorization: i.key,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              event: 'ENTITLEMENT_DELETE',
              entitlement: entitlement.toJSON(),
              tier,
              clientId: this.client.bot.user.id,
              shardId: this.client.shard.id
            })
          })
        )
      ).catch(() => {});
  }

  load() {
    this.registerEvent('entitlementCreate', this.onEntitlementCreate.bind(this));
    this.registerEvent('entitlementUpdate', this.onEntitlementUpdate.bind(this));
    this.registerEvent('entitlementDelete', this.onEntitlementDelete.bind(this));
    this.logger.info('Loaded');
  }

  unload() {
    this.unregisterAllEvents();
  }
}
