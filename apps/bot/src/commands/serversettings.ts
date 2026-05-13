import { stripIndents } from 'common-tags';
import { ButtonStyle, CommandContext, CommandOptionType, ComponentType, SlashCreator } from 'slash-create';

import { processCooldown } from '../redis';
import GeneralCommand from '../slashCommand';
import { checkBan } from '../util';

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export default class ServerSettings extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'server-settings',
      description: 'Manage server settings.',
      deferEphemeral: true,
      dmPermission: false,
      options: [
        {
          type: CommandOptionType.SUB_COMMAND,
          name: 'view',
          description: 'View server settings.'
        },
        {
          type: CommandOptionType.SUB_COMMAND_GROUP,
          name: 'access-role',
          description: 'Manage access roles.',
          options: [
            {
              type: CommandOptionType.SUB_COMMAND,
              name: 'add',
              description: 'Add an access role.',
              options: [
                {
                  type: CommandOptionType.ROLE,
                  name: 'role',
                  description: 'The role to add.',
                  required: true
                }
              ]
            },
            {
              type: CommandOptionType.SUB_COMMAND,
              name: 'remove',
              description: 'Remove an access role.',
              options: [
                {
                  type: CommandOptionType.ROLE,
                  name: 'role',
                  description: 'The role to remove.',
                  required: true
                }
              ]
            }
          ]
        },
        {
          type: CommandOptionType.SUB_COMMAND_GROUP,
          name: 'bot-profile',
          description: "Manage the bot's server profile.",
          options: [
            {
              type: CommandOptionType.SUB_COMMAND,
              name: 'edit',
              description: "Edit the bot's server profile.",
              options: [
                {
                  type: CommandOptionType.ATTACHMENT,
                  name: 'avatar',
                  description: 'The avatar to set.'
                },
                {
                  type: CommandOptionType.ATTACHMENT,
                  name: 'banner',
                  description: 'The banner to set.'
                }
              ]
            },
            {
              type: CommandOptionType.SUB_COMMAND,
              name: 'reset',
              description: "Reset the bot's server profile."
            }
          ]
        },
        {
          type: CommandOptionType.SUB_COMMAND_GROUP,
          name: 'summary-channel',
          description: 'Configure where AI summaries are posted for this server.',
          options: [
            {
              type: CommandOptionType.SUB_COMMAND,
              name: 'set',
              description: 'Set the channel where summaries will be posted.',
              options: [
                {
                  type: CommandOptionType.CHANNEL,
                  name: 'channel',
                  description: 'The text channel to post summaries in.',
                  required: true,
                  channel_types: [0] // GUILD_TEXT
                }
              ]
            },
            {
              type: CommandOptionType.SUB_COMMAND,
              name: 'clear',
              description: 'Remove the summary channel (summaries fall back to global webhook).'
            }
          ]
        }
      ]
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    if (!ctx.guildID) {
      return 'This command can only be used in a guild.';
    }
    const guild = this.client.bot.guilds.get(ctx.guildID);

    if (!guild) {
      return {
        content: 'This server is currently unavailable to me, try re-inviting this bot. If the issue persists, join the support server.',
        ephemeral: true,
        components: [
          {
            type: ComponentType.ACTION_ROW,
            components: [
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.LINK,
                label: 'Join Support Server',
                url: 'https://discord.gg/craig'
              }
            ]
          }
        ]
      };
    }

    if (await checkBan(ctx.user.id)) {
      return {
        content: 'You are not allowed to use the bot at this time.',
        ephemeral: true
      };
    }

    const userCooldown = await processCooldown(`command:${ctx.user.id}:${this.client?.bot?.user?.id}`, 5, 3);
    if (userCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the server-settings command, but was ratelimited.`
      );
      return {
        content: 'You are running commands too often! Try again in a few seconds.',
        ephemeral: true
      };
    }

    const guildData = await this.prisma.guild.findFirst({ where: { id: ctx.guildID } });
    if (!ctx.member!.permissions.has('MANAGE_GUILD')) {
      return {
        content: 'You need the `Manage Server` permission to change server settings.',
        ephemeral: true
      };
    }

    switch (ctx.subcommands[0]) {
      case 'view': {
        return {
          embeds: [
            {
              title: 'Server Settings',
              description: stripIndents`
                **Access Roles:** ${guildData && guildData.accessRoles.length ? guildData.accessRoles.map((r) => `<@&${r}>`).join(', ') : '*None*'}
                **Summary Channel:** ${guildData?.summaryChannelId ? `<#${guildData.summaryChannelId}>` : '*Not set*'}
              `
            }
          ],
          ephemeral: true
        };
      }
      case 'access-role': {
        switch (ctx.subcommands[1]) {
          case 'add': {
            const roleID = ctx.options['access-role'].add.role;
            if (guildData && guildData.accessRoles.includes(roleID)) {
              return {
                content: 'This role is already an access role.',
                ephemeral: true
              };
            }
            await this.prisma.guild.upsert({
              where: { id: ctx.guildID },
              update: {
                accessRoles: [...(guildData ? guildData.accessRoles.filter((r) => guild.roles.has(r)) : []), roleID]
              },
              create: { id: ctx.guildID, accessRoles: [roleID] }
            });
            return {
              content: `Added role <@&${roleID}> to access roles.`,
              ephemeral: true
            };
          }
          case 'remove': {
            const roleID = ctx.options['access-role'].remove.role;
            if (!guildData || !guildData.accessRoles.includes(roleID)) {
              return {
                content: 'This role is not an access role.',
                ephemeral: true
              };
            }
            await this.prisma.guild.update({
              where: { id: ctx.guildID },
              data: { accessRoles: guildData.accessRoles.filter((r) => r !== roleID).filter((r) => guild.roles.has(r)) }
            });
            return {
              content: `Removed <@&${roleID}> from access roles.`,
              ephemeral: true
            };
          }
        }
        break;
      }
      case 'summary-channel': {
        switch (ctx.subcommands[1]) {
          case 'set': {
            const summaryChannelId = ctx.options['summary-channel'].set.channel as string;
            const channel = guild.channels.get(summaryChannelId);
            if (!channel) return { content: 'Channel not found.', ephemeral: true };

            if (!channel.permissionsOf(this.client.bot.user.id).has('sendMessages')) {
              return {
                content: `I don't have permission to send messages in <#${summaryChannelId}>. Grant me Send Messages there first.`,
                ephemeral: true
              };
            }

            await this.prisma.guild.upsert({
              where: { id: ctx.guildID! },
              update: { summaryChannelId: summaryChannelId },
              create: { id: ctx.guildID!, accessRoles: [], summaryChannelId: summaryChannelId }
            });
            return { content: `Summary channel set to <#${summaryChannelId}>.`, ephemeral: true };
          }
          case 'clear': {
            await this.prisma.guild.upsert({
              where: { id: ctx.guildID! },
              update: { summaryChannelId: null },
              create: { id: ctx.guildID!, accessRoles: [], summaryChannelId: null }
            });
            return { content: 'Summary channel cleared.', ephemeral: true };
          }
        }
        break;
      }
      case 'bot-profile': {
        switch (ctx.subcommands[1]) {
          case 'edit': {
            const avatarAttachmentID = ctx.options['bot-profile'].edit.avatar;
            const bannerAttachmentID = ctx.options['bot-profile'].edit.banner;
            if (!avatarAttachmentID && !bannerAttachmentID) {
              return {
                content: "You didn't edit anything.",
                ephemeral: true
              };
            }

            const avatar = ctx.attachments.get(avatarAttachmentID);
            const banner = ctx.attachments.get(bannerAttachmentID);

            if (avatar && (!avatar.content_type || !ALLOWED_IMAGE_TYPES.includes(avatar.content_type))) {
              return {
                content: `The avatar trying to be set has an invalid content type.${avatar.content_type ? ` (${avatar.content_type})` : ''}`,
                ephemeral: true
              };
            }

            if (banner && (!banner.content_type || !ALLOWED_IMAGE_TYPES.includes(banner.content_type))) {
              return {
                content: `The banner trying to be set has an invalid content type.${banner.content_type ? ` (${banner.content_type})` : ''}`,
                ephemeral: true
              };
            }

            const userData = await this.entitlements.getCurrentUser(ctx);
            const blessing = await this.prisma.blessing.findFirst({ where: { guildId: guild.id } });
            const blessingUser = blessing ? await this.prisma.user.findFirst({ where: { id: blessing.userId } }) : null;
            const tier = userData?.rewardTier ?? blessingUser?.rewardTier ?? 0;
            if (tier === 0) {
              return {
                content: stripIndents`
                  Sorry, but this feature is only for Tier 1 supporters ($1 patrons).
                  If you have recently became a supporter, login to the [dashboard](https://my.craig.chat/).
                  Your benefits may take up to an hour to become active.
                `,
                components: [
                  {
                    type: ComponentType.ACTION_ROW,
                    components: [
                      {
                        type: ComponentType.BUTTON,
                        style: ButtonStyle.LINK,
                        label: 'Patreon',
                        url: 'https://patreon.com/CraigRec'
                      }
                    ]
                  }
                ],
                ephemeral: true
              };
            }

            try {
              const [avatarData, bannerData] = await Promise.all([
                avatar
                  ? `data:${avatar.content_type};base64,${await fetch(avatar.url)
                      .then((r) => r.arrayBuffer())
                      .then((b) => Buffer.from(b as any, 'binary').toString('base64'))}`
                  : undefined,
                banner
                  ? `data:${banner.content_type};base64,${await fetch(banner.url)
                      .then((r) => r.arrayBuffer())
                      .then((b) => Buffer.from(b as any, 'binary').toString('base64'))}`
                  : undefined
              ]);

              await this.client.bot.editGuildMember(ctx.guildID!, '@me', { avatar: avatarData, banner: bannerData });

              return {
                content: 'Updated my server profile.',
                ephemeral: true
              };
            } catch (e) {
              return {
                content: 'Could not update server my profile, you may have updated it too frequently.',
                ephemeral: true
              };
            }
          }
          case 'reset': {
            try {
              await this.client.bot.editGuildMember(ctx.guildID!, '@me', { avatar: null, banner: null });

              return {
                content: 'Reset my server profile.',
                ephemeral: true
              };
            } catch (e) {
              return {
                content: 'Could not update server my profile, you may have updated it too frequently.',
                ephemeral: true
              };
            }
          }
        }
      }
    }

    return {
      content: 'Unknown sub-command.',
      ephemeral: true
    };
  }
}
