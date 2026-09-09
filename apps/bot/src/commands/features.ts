import { ButtonStyle, CommandContext, ComponentType, SlashCreator } from 'slash-create';

import type { RewardTier } from '../config.js';
import type { TFunction } from '../i18n.js';
import { processCooldown } from '../redis.js';
import GeneralCommand from '../slashCommand.js';
import { checkBan } from '../util.js';

export default class Features extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'features',
      description: 'List your active perks and active server perks.',
      deferEphemeral: true
    });
  }

  formatRewards(rewards: RewardTier, tier: number, t: TFunction, by?: string) {
    return t('features.reward_details', {
      tier: [-1, 0, 10, 20, 30, 100].includes(tier) ? t(`features.tiers.${tier}`) : t('features.unknown_tier', { tier }),
      blessed_by: by ? t('features.blessed_by', { user: `<@${by}>` }) : '',
      record_hours: rewards.recordHours,
      expiry_days: rewards.downloadExpiryHours / 24,
      features: rewards.features.map((feature) => `${this.emojis.getMarkdown('check')} ${t(`features.feature.${feature}`)}`).join('\n')
    });
  }

  async run(ctx: CommandContext) {
    const [t] = this.createT(ctx);
    if (await checkBan(ctx.user.id))
      return {
        content: t('responses.banned'),
        ephemeral: true
      };

    const userCooldown = await processCooldown(`command:${ctx.user.id}:${this.client?.bot?.user?.id}`, 5, 3);
    if (userCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the features command, but was ratelimited.`
      );
      return {
        content: t('responses.ratelimited'),
        ephemeral: true
      };
    }

    const userData = await this.entitlements.getCurrentUser(ctx);
    const blessing = ctx.guildID ? await this.prisma.blessing.findUnique({ where: { guildId: ctx.guildID }, select: { userId: true } }) : null;
    const blessingUser = blessing
      ? await this.prisma.user.findUnique({ where: { id: blessing.userId }, select: { id: true, rewardTier: true } })
      : null;

    const userTier = userData?.rewardTier || 0;
    const guildTier = blessingUser?.rewardTier || 0;
    const userRewards = this.client.config.craig.rewardTiers[userTier] || this.client.config.craig.rewardTiers[0];
    const guildRewards = this.client.config.craig.rewardTiers[guildTier] || this.client.config.craig.rewardTiers[0];

    return {
      ephemeral: true,
      embeds: [
        {
          title: t('features.title'),
          fields: [
            {
              name: t('features.your_perks'),
              value: this.formatRewards(userRewards, userTier, t),
              inline: true
            },
            {
              name: t('features.server_perks'),
              value: !ctx.guildID || !blessingUser ? null : this.formatRewards(guildRewards, guildTier, t, blessingUser.id),
              inline: true
            }
          ].filter((f) => f.value),
          footer: {
            text: ctx.guildID && !blessingUser && userTier !== 0 ? t('features.no_server_perks') : null
          }
        }
      ],
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.BUTTON,
              style: ButtonStyle.LINK,
              label: t('common.dashboard'),
              url: this.client.config.craig.dashboardURL
            },
            ...(ctx.guildID && !blessingUser && userTier !== 0
              ? [
                  {
                    type: ComponentType.BUTTON,
                    style: ButtonStyle.SUCCESS,
                    label: t('features.bless_server'),
                    custom_id: `user:bless:${ctx.guildID}`
                  }
                ]
              : [])
          ]
        }
      ]
    };
  }
}
