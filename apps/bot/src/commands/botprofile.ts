import { stripIndents } from 'common-tags';
import { ButtonStyle, CommandContext, CommandOptionType, ComponentType, SlashCreator } from 'slash-create';

import { processCooldown } from '../redis.js';
import GeneralCommand from '../slashCommand.js';
import { checkBan } from '../util.js';

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export default class BotProfile extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'bot-profile',
      description: "Update the bot's server profile.",
      deferEphemeral: true,
      dmPermission: false,
      options: [
        {
          type: CommandOptionType.SUB_COMMAND,
          name: 'edit',
          description: "Edit the bot's server profile.",
          options: [
            { type: CommandOptionType.ATTACHMENT, name: 'avatar', description: 'The avatar to set.' },
            { type: CommandOptionType.ATTACHMENT, name: 'banner', description: 'The banner to set.' }
          ]
        },
        { type: CommandOptionType.SUB_COMMAND, name: 'reset', description: "Reset the bot's server profile." }
      ]
    });
  }

  async run(ctx: CommandContext) {
    if (!ctx.guildID) return 'This command can only be used in a guild.';
    const guild = this.client.bot.guilds.get(ctx.guildID);
    if (!guild)
      return {
        content: 'This server is currently unavailable to me, try re-inviting this bot. If the issue persists, join the support server.',
        ephemeral: true
      };
    if (await checkBan(ctx.user.id)) return { content: 'You are not allowed to use the bot at this time.', ephemeral: true };

    const userCooldown = await processCooldown(`command:${ctx.user.id}:${this.client?.bot?.user?.id}`, 5, 3);
    if (userCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the bot-profile command, but was ratelimited.`
      );
      return { content: 'You are running commands too often! Try again in a few seconds.', ephemeral: true };
    }
    if (!ctx.member!.permissions.has('MANAGE_GUILD'))
      return { content: 'You need the `Manage Server` permission to change the bot profile.', ephemeral: true };

    switch (ctx.subcommands[0]) {
      case 'edit':
        return this.edit(ctx, guild);
      case 'reset':
        try {
          await this.client.bot.editGuildMember(ctx.guildID, '@me', { avatar: null, banner: null });
          return { content: 'Reset my server profile.', ephemeral: true };
        } catch {
          return { content: 'Could not reset my server profile; you may have updated it too frequently.', ephemeral: true };
        }
    }
    return { content: 'Unknown sub-command.', ephemeral: true };
  }

  private async edit(ctx: CommandContext, guild: NonNullable<ReturnType<typeof this.client.bot.guilds.get>>) {
    const avatarAttachmentID = ctx.options.edit.avatar;
    const bannerAttachmentID = ctx.options.edit.banner;
    if (!avatarAttachmentID && !bannerAttachmentID) return { content: "You didn't edit anything.", ephemeral: true };
    const avatar = ctx.attachments.get(avatarAttachmentID);
    const banner = ctx.attachments.get(bannerAttachmentID);
    for (const [name, attachment] of [
      ['avatar', avatar],
      ['banner', banner]
    ] as const)
      if (attachment && (!attachment.content_type || !ALLOWED_IMAGE_TYPES.includes(attachment.content_type)))
        return {
          content: `The ${name} trying to be set has an invalid content type.${attachment.content_type ? ` (${attachment.content_type})` : ''}`,
          ephemeral: true
        };

    const userData = await this.entitlements.getCurrentUser(ctx);
    const blessing = await this.prisma.blessing.findUnique({ where: { guildId: guild.id }, select: { userId: true } });
    const blessingUser = blessing ? await this.prisma.user.findUnique({ where: { id: blessing.userId }, select: { rewardTier: true } }) : null;
    if ((userData?.rewardTier ?? blessingUser?.rewardTier ?? 0) === 0)
      return {
        content: stripIndents`
          Sorry, but this feature is only for Tier 1 supporters ($1 patrons).
          If you have recently became a supporter, login to the [dashboard](https://my.craig.chat/).
          Your benefits may take up to an hour to become active.
        `,
        components: [
          {
            type: ComponentType.ACTION_ROW,
            components: [{ type: ComponentType.BUTTON, style: ButtonStyle.LINK, label: 'Patreon', url: 'https://patreon.com/CraigRec' }]
          }
        ],
        ephemeral: true
      };
    try {
      const toDataURL = async (attachment: typeof avatar) =>
        attachment &&
        `data:${attachment.content_type};base64,${Buffer.from((await fetch(attachment.url).then((r) => r.arrayBuffer())) as any, 'binary').toString('base64')}`;
      const [avatarData, bannerData] = await Promise.all([toDataURL(avatar), toDataURL(banner)]);
      await this.client.bot.editGuildMember(ctx.guildID!, '@me', { avatar: avatarData, banner: bannerData });
      return { content: 'Updated my server profile.', ephemeral: true };
    } catch {
      return { content: 'Could not update my server profile; you may have updated it too frequently.', ephemeral: true };
    }
  }
}
