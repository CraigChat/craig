import { ButtonStyle, ChannelType, CommandContext, CommandOptionType, ComponentType, SlashCreator } from 'slash-create';

import { processCooldown } from '../redis.js';
import GeneralCommand from '../slashCommand.js';
import { checkBan, checkRecordingPermission, parseRewards } from '../util.js';

export default class AutoRecord extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'autorecord',
      description: 'Manage auto-record settings.',
      deferEphemeral: true,
      dmPermission: false,
      options: [
        {
          type: CommandOptionType.SUB_COMMAND,
          name: 'view',
          description: 'View auto-recorded channels.',
          options: [
            {
              type: CommandOptionType.CHANNEL,
              name: 'channel',
              description: 'The channel to view.',
              channel_types: [ChannelType.GUILD_VOICE, ChannelType.GUILD_STAGE_VOICE]
            }
          ]
        },
        {
          type: CommandOptionType.SUB_COMMAND,
          name: 'on',
          description: 'Activate auto-recording on a channel.',
          options: [
            {
              type: CommandOptionType.CHANNEL,
              name: 'channel',
              description: 'The channel to auto-record in.',
              channel_types: [ChannelType.GUILD_VOICE, ChannelType.GUILD_STAGE_VOICE],
              required: true
            },
            {
              type: CommandOptionType.INTEGER,
              name: 'minimum',
              description: 'The minimum amount of members to auto-record on, regardless of triggers.',
              min_value: 0,
              max_value: 99
            },
            {
              type: CommandOptionType.STRING,
              name: 'triggers',
              description: 'The members or roles that trigger the auto-recording. Mention users/roles inside this option.'
            },
            {
              type: CommandOptionType.CHANNEL,
              name: 'post-channel',
              description: 'The channel to post recording panels to when an auto-recording starts.',
              channel_types: [
                ChannelType.GUILD_TEXT,
                ChannelType.GUILD_PUBLIC_THREAD,
                ChannelType.GUILD_PRIVATE_THREAD,
                ChannelType.GUILD_VOICE,
                ChannelType.GUILD_STAGE_VOICE
              ]
            }
          ]
        },
        {
          type: CommandOptionType.SUB_COMMAND,
          name: 'off',
          description: 'Deactivate auto-recording on a channel.',
          options: [
            {
              type: CommandOptionType.CHANNEL,
              name: 'channel',
              description: 'The channel to turn off auto-recording in.',
              channel_types: [ChannelType.GUILD_VOICE, ChannelType.GUILD_STAGE_VOICE],
              required: true
            }
          ]
        },
        {
          type: CommandOptionType.SUB_COMMAND,
          name: 'prune',
          description: 'Remove auto-record rules for channels that no longer exist.'
        }
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
        ephemeral: true,
        components: [
          {
            type: ComponentType.ACTION_ROW,
            components: [
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.LINK,
                label: t('common.support_server'),
                url: 'https://discord.gg/craig'
              }
            ]
          }
        ]
      };

    if (await checkBan(ctx.user.id))
      return {
        content: t('responses.banned'),
        ephemeral: true
      };

    const userCooldown = await processCooldown(`command:${ctx.user.id}:${this.client?.bot?.user?.id}`, 5, 3);
    if (userCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the autorecord command, but was ratelimited.`
      );
      return {
        content: t('responses.ratelimited'),
        ephemeral: true
      };
    }

    const guildData = await this.prisma.guild.findUnique({ where: { id: ctx.guildID } });
    const hasPermission = checkRecordingPermission(ctx.member!, guildData);
    if (!hasPermission)
      return {
        content: t('autorecord.need_perms'),
        components: [
          {
            type: ComponentType.ACTION_ROW,
            components: [
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.LINK,
                label: t('common.how_fix'),
                url: 'https://docs.craig.chat/features/access-roles/'
              }
            ]
          }
        ],
        ephemeral: true
      };

    switch (ctx.subcommands[0]) {
      case 'view': {
        if (ctx.options.view.channel) {
          const autoRecording = await this.prisma.autoRecord.findUnique({
            where: {
              clientId_guildId_channelId: {
                clientId: this.client.bot.user.id,
                guildId: ctx.guildID,
                channelId: ctx.options.view.channel
              }
            }
          });

          if (!autoRecording)
            return {
              content: t('autorecord.not_recorded', { channel: `<#${ctx.options.view.channel}>` }),
              ephemeral: true
            };

          return {
            embeds: [
              {
                title: ctx.channels.get(ctx.options.view.channel)?.name ?? t('autorecord.unknown_channel'),
                description: t('autorecord.view_channel', {
                  channel: `<#${ctx.options.view.channel}>`,
                  user: `<@${autoRecording.userId}>`,
                  minimum: autoRecording.minimum === 0 ? t('autorecord.none') : autoRecording.minimum.toLocaleString(),
                  roles: autoRecording.triggerRoles.map((roleId) => `<@&${roleId}>`).join(', ') || t('autorecord.none'),
                  users: autoRecording.triggerUsers.map((userId) => `<@${userId}>`).join(', ') || t('autorecord.none'),
                  updated_at: `<t:${Math.round(autoRecording.updatedAt.valueOf() / 1000)}:F>`
                })
              }
            ],
            ephemeral: true
          };
        }

        const autoRecordings = await this.prisma.autoRecord.findMany({
          where: { guildId: ctx.guildID, clientId: this.client.bot.user.id }
        });

        if (autoRecordings.length === 0)
          return {
            content: t('autorecord.no_channels'),
            ephemeral: true
          };

        return {
          embeds: [
            {
              title: t('autorecord.channels_title'),
              description: autoRecordings
                .map((ar) => {
                  const extra = [
                    ar.minimum !== 0 ? t('autorecord.minimum', { count: ar.minimum }) : null,
                    ar.triggerRoles.length > 0 ? t('autorecord.roles', { count: ar.triggerRoles.length }) : null,
                    ar.triggerUsers.length > 0 ? t('autorecord.users', { count: ar.triggerUsers.length }) : null,
                    ar.postChannelId ? t('autorecord.posting_to', { channel: `<#${ar.postChannelId}>` }) : null
                  ].filter((e) => !!e) as string[];
                  return `<#${ar.channelId}> by <@${ar.userId}>${extra.length !== 0 ? ` (${extra.join(', ')})` : ''}`;
                })
                .join('\n')
            }
          ],
          ephemeral: true
        };
      }
      case 'on': {
        // Get rewards
        const userData = await this.entitlements.getCurrentUser(ctx);
        const blessing = await this.prisma.blessing.findUnique({ where: { guildId: guild.id }, select: { userId: true } });
        const blessingUser = blessing ? await this.prisma.user.findUnique({ where: { id: blessing.userId }, select: { rewardTier: true } }) : null;
        const parsedRewards = parseRewards(this.recorder.client.config, userData?.rewardTier ?? 0, blessingUser?.rewardTier ?? 0);
        // Check if user can manage auto-recordings
        if (!parsedRewards.rewards.features.includes('auto'))
          return {
            content: `${t('autorecord.supporter_required')}\n${t('responses.supporter_required', {
              dashboard_url: this.client.config.craig.dashboardURL
            })}`,
            components: [
              {
                type: ComponentType.ACTION_ROW,
                components: [
                  {
                    type: ComponentType.BUTTON,
                    style: ButtonStyle.LINK,
                    label: t('common.supporter_cta'),
                    url: 'https://craig.chat/supporter'
                  }
                ]
              }
            ],
            ephemeral: true
          };

        const channel = ctx.options.on.channel as string;
        const min = ctx.options.on.minimum ?? 0;
        const triggerUsers = ctx.users.map((u) => u.id);
        const triggerRoles = ctx.roles.map((r) => r.id);
        const postChannel = ctx.options.on['post-channel'] as string;

        if (min === 0 && triggerUsers.length <= 0 && triggerRoles.length <= 0)
          return {
            content: t('autorecord.need_trigger'),
            ephemeral: true
          };

        if (triggerRoles.includes(guild.id))
          return {
            content: t('autorecord.everyone_trigger'),
            ephemeral: true
          };

        const autoRecordingCount = await this.prisma.autoRecord.count({
          where: { guildId: ctx.guildID, clientId: this.client.bot.user.id }
        });

        if (autoRecordingCount >= 10)
          return {
            content: t('autorecord.limit_reached', { limit: 10 }),
            ephemeral: true
          };

        await this.autoRecord.upsert({
          guildId: ctx.guildID,
          channelId: channel,
          userId: ctx.user.id,
          postChannelId: postChannel || null,
          minimum: min,
          triggerUsers,
          triggerRoles
        });

        return {
          content: t('autorecord.activated', { channel: `<#${channel}>` }),
          ephemeral: true
        };
      }
      case 'off': {
        const channel = ctx.options.off.channel as string;

        const autoRecording = await this.prisma.autoRecord.findUnique({
          where: {
            clientId_guildId_channelId: {
              clientId: this.client.bot.user.id,
              guildId: ctx.guildID,
              channelId: channel
            }
          }
        });

        if (autoRecording) await this.autoRecord.delete(autoRecording);
        else
          return {
            content: t('autorecord.not_found', { channel: `<#${channel}>` }),
            ephemeral: true
          };

        return {
          content: t('autorecord.deactivated', { channel: `<#${channel}>` }),
          ephemeral: true
        };
      }
      case 'prune': {
        const result = await this.prisma.autoRecord.deleteMany({
          where: {
            guildId: ctx.guildID,
            clientId: this.client.bot.user.id,
            channelId: { notIn: guild.channels.map((c) => c.id) }
          }
        });

        return {
          content: t('autorecord.pruned', { count: result.count }),
          ephemeral: true
        };
      }
    }

    return {
      content: t('responses.unknown_subcommand'),
      ephemeral: true
    };
  }
}
