import { getGuildBlessing } from '@craig/db';
import Dysnomia from '@projectdysnomia/dysnomia';
import { ButtonStyle, CommandContext, CommandOptionType, ComponentType, SlashCreator } from 'slash-create';

import type { TFunction } from '../i18n.js';
import { processCooldown } from '../redis.js';
import GeneralCommand from '../slashCommand.js';
import { checkBan } from '../util.js';

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT = 10000;

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
    ] as const) {
      if (attachment && (!attachment.content_type || !ALLOWED_IMAGE_TYPES.includes(attachment.content_type)))
        return {
          content: `${t('botprofile.invalid_content_type', { item: t(`botprofile.item.${name}`) })}${attachment.content_type ? ` (${attachment.content_type})` : ''}`,
          ephemeral: true
        };
      if (attachment && attachment.size > MAX_IMAGE_SIZE)
        return { content: t('botprofile.too_large', { item: t(`botprofile.item.${name}`), max: MAX_IMAGE_SIZE / 1024 / 1024 }), ephemeral: true };
    }

    const userData = await this.entitlements.getCurrentUser(ctx);
    const blessing = await getGuildBlessing(guild.id);
    if ((userData?.rewardTier || blessing?.rewardTier || 0) === 0)
      return {
        content: `${t('botprofile.supporter_required')}\n${t('responses.supporter_required', { dashboard_url: this.client.config.craig.dashboardURL })}`,
        components: [
          {
            type: ComponentType.ACTION_ROW,
            components: [
              { type: ComponentType.BUTTON, style: ButtonStyle.LINK, label: t('common.supporter_cta'), url: 'https://craig.chat/supporter' }
            ]
          }
        ],
        ephemeral: true
      };
    try {
      const toDataURL = async (attachment: typeof avatar) => {
        if (!attachment) return attachment;
        const res = await fetch(attachment.url, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT) });
        if (!res.ok) throw new Error(`Failed to fetch attachment: ${res.status}`);
        const contentLength = Number(res.headers.get('content-length'));
        if (contentLength > MAX_IMAGE_SIZE) {
          await res.body?.cancel();
          throw new Error('Attachment too large');
        }
        const data = Buffer.from(await res.arrayBuffer());
        if (data.length > MAX_IMAGE_SIZE) throw new Error('Attachment too large');
        return `data:${attachment.content_type};base64,${data.toString('base64')}`;
      };
      const [avatarData, bannerData] = await Promise.all([toDataURL(avatar), toDataURL(banner)]);
      await this.client.bot.editGuildMember(ctx.guildID!, '@me', { avatar: avatarData, banner: bannerData });
      return { content: t('botprofile.updated'), ephemeral: true };
    } catch {
      return { content: t('botprofile.update_fail'), ephemeral: true };
    }
  }
}
