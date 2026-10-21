import { activeRewardTier, db, rewardTierUpdate } from '@craig/db';
import Dysnomia from '@projectdysnomia/dysnomia';
import { CommandContext, ComponentContext } from 'slash-create';

import type { CraigBot } from '../bot.js';
import { BotModule } from '../runtime.js';

const WEBHOOK_TIMEOUT = 5000;

export default class EntitlementsModule extends BotModule {
  private readonly handleEntitlementCreate = this.onEntitlementCreate.bind(this);
  private readonly handleEntitlementUpdate = this.onEntitlementUpdate.bind(this);
  private readonly handleEntitlementDelete = this.onEntitlementDelete.bind(this);

  constructor(client: CraigBot) {
    super(client, {
      name: 'entitlements',
      description: 'Entitlement management and propogation'
    });
  }

  async getCurrentUser(ctx: ComponentContext | CommandContext) {
    const userId = ctx.user.id;

    const dbEntitlement = await db
      .selectFrom('Entitlement')
      .select(['tier', 'sourceEntitlementId', 'expiresAt'])
      .where('userId', '=', userId)
      .where('source', '=', 'discord')
      .executeTakeFirst();

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
          await this.upsertDiscordEntitlement(userId, {
            tier: maxTier,
            sourceEntitlementId: bestEntitlement.id,
            expiresAt: bestEntitlement.ends_at ? new Date(bestEntitlement.ends_at) : null
          });
        }
      }
    } else if (dbEntitlement) await this.deleteDiscordEntitlement(userId);

    return await this.resolveUserEntitlement(userId);
  }

  resolveUserEntitlement(userId: string) {
    return db
      .insertInto('User')
      .values({ id: userId, rewardTier: activeRewardTier(userId) })
      .onConflict((oc) => oc.column('id').doUpdateSet(rewardTierUpdate))
      .returning(['id', 'rewardTier', 'webapp', 'includeBots'])
      .executeTakeFirstOrThrow();
  }

  upsertDiscordEntitlement(userId: string, data: { tier: number; sourceEntitlementId: string; expiresAt: Date | null; note?: string }) {
    return db
      .insertInto('Entitlement')
      .values({ userId, source: 'discord', ...data })
      .onConflict((oc) => oc.columns(['userId', 'source']).doUpdateSet(data))
      .execute();
  }

  deleteDiscordEntitlement(userId: string) {
    return db.deleteFrom('Entitlement').where('userId', '=', userId).where('source', '=', 'discord').execute();
  }

  getTierFromSKU(sku: string) {
    const tierString = Object.entries(this.client.config.craig.rewardTiers).find(([, tier]) => tier.discordSkuId === sku)?.[0] ?? null;
    if (tierString === null) return;
    const tier = parseInt(tierString, 10);
    if (!this.client.config.craig.rewardTiers[tier]) return;
    return tier;
  }

  async onEntitlementCreate(entitlement: Dysnomia.Entitlement) {
    const tier = this.getTierFromSKU(entitlement.skuID);
    if (tier === undefined || !entitlement.userID) return;
    const testEntitlement = !entitlement.startsAt;
    await this.upsertDiscordEntitlement(entitlement.userID, {
      tier,
      sourceEntitlementId: entitlement.id,
      expiresAt: entitlement.endsAt ? new Date(entitlement.endsAt) : null,
      ...(testEntitlement ? { note: 'Test entitlement' } : {})
    });
    await this.resolveUserEntitlement(entitlement.userID);
    if (this.client.config.craig.entitlementWebhookURLs)
      await Promise.all(
        this.client.config.craig.entitlementWebhookURLs.map((i) =>
          fetch(i.url, {
            method: 'POST',
            signal: AbortSignal.timeout(WEBHOOK_TIMEOUT),
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

  async onEntitlementUpdate(entitlement: Dysnomia.Entitlement) {
    const tier = this.getTierFromSKU(entitlement.skuID);
    if (tier === undefined || !entitlement.userID) return;
    const testEntitlement = !entitlement.startsAt;
    await this.upsertDiscordEntitlement(entitlement.userID, {
      tier,
      sourceEntitlementId: entitlement.id,
      expiresAt: entitlement.endsAt ? new Date(entitlement.endsAt) : null,
      ...(testEntitlement ? { note: 'Test entitlement' } : {})
    });
    await this.resolveUserEntitlement(entitlement.userID);
    if (this.client.config.craig.entitlementWebhookURLs)
      await Promise.all(
        this.client.config.craig.entitlementWebhookURLs.map((i) =>
          fetch(i.url, {
            method: 'POST',
            signal: AbortSignal.timeout(WEBHOOK_TIMEOUT),
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

  async onEntitlementDelete(entitlement: Dysnomia.Entitlement) {
    const tier = this.getTierFromSKU(entitlement.skuID);
    if (tier === undefined || !entitlement.userID) return;
    await this.deleteDiscordEntitlement(entitlement.userID);
    await this.resolveUserEntitlement(entitlement.userID);
    if (this.client.config.craig.entitlementWebhookURLs)
      await Promise.all(
        this.client.config.craig.entitlementWebhookURLs.map((i) =>
          fetch(i.url, {
            method: 'POST',
            signal: AbortSignal.timeout(WEBHOOK_TIMEOUT),
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
    this.client.bot.on('entitlementCreate', this.handleEntitlementCreate);
    this.client.bot.on('entitlementUpdate', this.handleEntitlementUpdate);
    this.client.bot.on('entitlementDelete', this.handleEntitlementDelete);
  }

  unload() {
    this.client.bot.removeListener('entitlementCreate', this.handleEntitlementCreate);
    this.client.bot.removeListener('entitlementUpdate', this.handleEntitlementUpdate);
    this.client.bot.removeListener('entitlementDelete', this.handleEntitlementDelete);
  }
}
