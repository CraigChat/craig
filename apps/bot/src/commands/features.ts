import { stripIndents } from 'common-tags';
import { ButtonStyle, CommandContext, ComponentType, SlashCreator } from 'slash-create';

import type { RewardTier } from '../bot';
import { processCooldown } from '../redis';
import GeneralCommand from '../slashCommand';
import { checkBan } from '../util';

export default class Features extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'features',
      description: 'List your active perks and active server perks.',
      deferEphemeral: true
    });

    this.filePath = __filename;
  }

  formatRewards(rewards: RewardTier, tier: number, by?: string) {
    const tierNames: { [key: number]: string } = {
      [-1]: 'Greater Weasel',
      0: 'Default',
      10: 'Supporter',
      20: 'Better Supporter',
      30: 'FLAC Demander',
      100: 'MP3 God'
    };

    const featureNames: { [key: string]: string } = {
      mix: 'Smart Mix',
      auto: 'Auto-recording',
      drive: 'Cloud Backup',
      glowers: 'Avatar Overlays',
      eccontinuous: 'Continuous Mode via Webapp',
      ecflac: 'FLAC via Webapp',
      mp3: 'Exporting to MP3'
    };

    return stripIndents`
      __**${tierNames[tier] || `Tier ${tier}`}**__ ${by ? `(Blessed by <@${by}>)` : ''}
      Record Duration Limit: ${rewards.recordHours} hours
      Download Expiration: ${rewards.downloadExpiryHours / 24} days

      ${rewards.features.map((feat) => `${this.emojis.getMarkdown('check')} ${featureNames[feat] ?? feat}`).join('\n')}
    `;
  }

  async run(ctx: CommandContext) {
    if (await checkBan(ctx.user.id))
      return {
        content: 'You are not allowed to use the bot at this time.',
        ephemeral: true
      };

    const userCooldown = await processCooldown(`command:${ctx.user.id}`, 5, 3);
    if (userCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the features command, but was ratelimited.`
      );
      return {
        content: 'You are running commands too often! Try again in a few seconds.',
        ephemeral: true
      };
    }

    const userData = await this.prisma.user.findFirst({ where: { id: ctx.user.id } });
    const blessing = ctx.guildID ? await this.prisma.blessing.findFirst({ where: { guildId: ctx.guildID } }) : null;
    const blessingUser = blessing ? await this.prisma.user.findFirst({ where: { id: blessing.userId } }) : null;

    const userTier = userData?.rewardTier || 0;
    const guildTier = blessingUser?.rewardTier || 0;
    const userRewards = this.client.config.craig.rewardTiers[userTier] || this.client.config.craig.rewardTiers[0];
    const guildRewards = this.client.config.craig.rewardTiers[guildTier] || this.client.config.craig.rewardTiers[0];

    return {
      ephemeral: true,
      embeds: [
        {
          title: 'Features',
          fields: [
            {
              name: 'Your Perks',
              value: this.formatRewards(userRewards, userTier),
              inline: true
            },
            {
              name: 'Server Perks',
              value: !ctx.guildID || !blessingUser ? null : this.formatRewards(guildRewards, guildTier, blessingUser.id),
              inline: true
            }
          ].filter((f) => f.value),
          footer: {
            text: ctx.guildID && !blessingUser && userTier !== 0 ? 'This server has no perks, you can bless this server.' : null
          }
        }
      ],
      components:
        ctx.guildID && !blessingUser && userTier !== 0
          ? [
              {
                type: ComponentType.ACTION_ROW,
                components: [
                  {
                    type: ComponentType.BUTTON,
                    style: ButtonStyle.SUCCESS,
                    label: 'Bless server',
                    custom_id: `user:bless:${ctx.guildID}`
                  }
                ]
              }
            ]
          : []
    };
  }
}
