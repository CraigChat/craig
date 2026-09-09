import Dysnomia from '@projectdysnomia/dysnomia';
import { ButtonStyle, CommandContext, CommandOptionType, ComponentType, SlashCreator } from 'slash-create';

import type { TFunction } from '../i18n.js';
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
    const [t] = this.createT(ctx);

    if (!ctx.guildID) return t('responses.guild_only');
    const guild = this.client.bot.guilds.get(ctx.guildID);
    if (!guild)
      return {
        content: t('responses.guild_unavailable', { server_invite: 'https://discord.gg/craig' }),
        ephemeral: true
      };
    if (await checkBan(ctx.user.id))
      return {
        content: t('responses.banned'),
        ephemeral: true
      };

    const userCooldown = await processCooldown(`command:${ctx.user.id}:${this.client?.bot?.user?.id}`, 5, 3);
    if (userCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the bot-profile command, but was ratelimited.`
      );
      return { content: t('responses.ratelimited'), ephemeral: true };
    }
    if (!ctx.member!.permissions.has('MANAGE_GUILD')) return { content: t('botprofile.need_perms'), ephemeral: true };

    switch (ctx.subcommands[0]) {
      case 'edit':
        return this.edit(ctx, guild, t);
      case 'reset':
        try {
          await this.client.bot.editGuildMember(ctx.guildID, '@me', { avatar: null, banner: null });
          return { content: t('botprofile.reset'), ephemeral: true };
        } catch {
          return { content: t('botprofile.reset_fail'), ephemeral: true };
        }
    }
    return { content: t('responses.unknown_subcommand'), ephemeral: true };
  }

  private async edit(ctx: CommandContext, guild: Dysnomia.Guild, t: TFunction) {
    const avatarAttachmentID = ctx.options.edit.avatar;
    const bannerAttachmentID = ctx.options.edit.banner;
    if (!avatarAttachmentID && !bannerAttachmentID) return { content: t('botprofile.no_edit'), ephemeral: true };
    const avatar = ctx.attachments.get(avatarAttachmentID);
    const banner = ctx.attachments.get(bannerAttachmentID);
    for (const [name, attachment] of [
      ['avatar', avatar],
      ['banner', banner]
    ] as const)
      if (attachment && (!attachment.content_type || !ALLOWED_IMAGE_TYPES.includes(attachment.content_type)))
        return {
          content: `${t('botprofile.invalid_content_type', { item: t(`botprofile.item.${name}`) })}${attachment.content_type ? ` (${attachment.content_type})` : ''}`,
          ephemeral: true
        };

    const userData = await this.entitlements.getCurrentUser(ctx);
    const blessing = await this.prisma.blessing.findUnique({ where: { guildId: guild.id }, select: { userId: true } });
    const blessingUser = blessing ? await this.prisma.user.findUnique({ where: { id: blessing.userId }, select: { rewardTier: true } }) : null;
    if ((userData?.rewardTier ?? blessingUser?.rewardTier ?? 0) === 0)
      return {
        content: `${t('botprofile.supporter_required')}\n${t('responses.supporter_required', { dashboard_url: this.client.config.craig.dashboardURL })}`,
        components: [
          {
            type: ComponentType.ACTION_ROW,
            components: [
              { type: ComponentType.BUTTON, style: ButtonStyle.LINK, label: t('common.support_craig'), url: 'https://craig.chat/supporter' }
            ]
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
      return { content: t('botprofile.updated'), ephemeral: true };
    } catch {
      return { content: t('botprofile.update_fail'), ephemeral: true };
    }
  }
}
