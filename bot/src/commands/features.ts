import { stripIndents } from 'common-tags';
import { SlashCreator, CommandContext } from 'slash-create';
import { RewardTier } from '../bot';
import GeneralCommand from '../slashCommand';

export default class Features extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'features',
      description: 'List your active perks and active server perks.',
      deferEphemeral: true
    });
  }

  formatRewards(rewards: RewardTier, tier: number, by?: string) {
    const tierNames: { [key: number]: string } = {
      [-1]: 'Greater Weasel',
      0: 'Default',
      10: 'Weasel',
      20: 'Better Weasel',
      30: 'FLAC Weasel',
      40: 'MP3 God Weasel'
    };

    return stripIndents`
      __**${tierNames[tier] || `Tier ${tier}`}**__ ${by ? `(Blessed by <@${by}>)` : ''}
      Record Duration Limit: ${rewards.recordHours} hours
      Download Expiration: ${rewards.downloadExpiryHours / 24} days

      ${rewards.features.map((feat) => `<:check:842172191801212949> ${feat}`).join('\n')}
    `;
  }

  async run(ctx: CommandContext) {
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
              name: 'Guild Perks',
              value: !ctx.guildID
                ? '*You are not in a guild.*'
                : !blessingUser
                ? '*This guild has no rewards.*'
                : this.formatRewards(guildRewards, guildTier, blessingUser.id),
              inline: true
            }
          ]
        }
      ]
    };
  }
}
