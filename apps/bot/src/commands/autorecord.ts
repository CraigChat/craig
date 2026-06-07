import { stripIndents } from 'common-tags';
import { ButtonStyle, ChannelType, CommandContext, CommandOptionType, ComponentType, SlashCreator } from 'slash-create';

import { processCooldown } from '../redis';
import GeneralCommand from '../slashCommand';
import { checkBan, checkRecordingPermission } from '../util';

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
              description: 'The minimum amount of members to auto-record on.',
              min_value: 1,
              max_value: 99,
              required: true
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
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the autorecord command, but was ratelimited.`
      );
      return {
        content: 'You are running commands too often! Try again in a few seconds.',
        ephemeral: true
      };
    }

    const guildData = await this.prisma.guild.findFirst({ where: { id: ctx.guildID } });
    const hasPermission = checkRecordingPermission(ctx.member!, guildData);
    if (!hasPermission) {
      return {
        content: 'You need the `Manage Server` permission or have an access role to manage auto-recordings.',
        components: [
          {
            type: ComponentType.ACTION_ROW,
            components: [
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.LINK,
                label: 'How do I fix this?',
                url: 'https://craig.chat/docs/#setting-up-access-roles'
              }
            ]
          }
        ],
        ephemeral: true
      };
    }

    switch (ctx.subcommands[0]) {
      case 'view': {
        if (ctx.options.view.channel) {
          const autoRecording = await this.prisma.autoRecord.findFirst({
            where: { guildId: ctx.guildID, clientId: this.client.bot.user.id, voiceChannelId: ctx.options.view.channel }
          });

          if (!autoRecording) {
            return {
              content: `The channel <#${ctx.options.view.channel}> is not auto-recorded.`,
              ephemeral: true
            };
          }

          return {
            embeds: [
              {
                title: ctx.channels.get(ctx.options.view.channel)?.name ?? 'Unknown channel',
                description: stripIndents`
                  **Channel:** <#${ctx.options.view.channel}>
                  **Created by:** <@${autoRecording.userId}>
                  **Minimum members:** ${autoRecording.minimum.toLocaleString()}
                  **Updated at:** <t:${Math.round(autoRecording.updatedAt.valueOf() / 1000)}:F>
                `
              }
            ],
            ephemeral: true
          };
        }

        const autoRecordings = await this.prisma.autoRecord.findMany({
          where: { guildId: ctx.guildID, clientId: this.client.bot.user.id }
        });

        if (autoRecordings.length === 0) {
          return {
            content: 'There are no auto-recorded channels.',
            ephemeral: true
          };
        }

        return {
          embeds: [
            {
              title: 'Auto-recorded Channels',
              description: autoRecordings
                .map((ar) => {
                  const extra = [`${ar.minimum} minimum`, ar.postChannelId ? `posting to <#${ar.postChannelId}>` : null].filter(
                    (e) => !!e
                  ) as string[];
                  return `<#${ar.voiceChannelId}> by <@${ar.userId}>${extra.length !== 0 ? ` (${extra.join(', ')})` : ''}`;
                })
                .join('\n')
            }
          ],
          ephemeral: true
        };
      }
      case 'on': {
        const channel = ctx.options.on.channel as string;
        const min = ctx.options.on.minimum as number;
        const postChannel = ctx.options.on['post-channel'] as string;

        const autoRecordingCount = await this.prisma.autoRecord.count({
          where: { guildId: ctx.guildID, clientId: this.client.bot.user.id }
        });

        if (autoRecordingCount >= 10) {
          return {
            content: 'You can only have 10 auto-recordings at a time.',
            ephemeral: true
          };
        }

        await this.autoRecord.upsert({
          guildId: ctx.guildID,
          voiceChannelId: channel,
          userId: ctx.user.id,
          postChannelId: postChannel || null,
          minimum: min
        });

        return {
          content: `Auto-recording on <#${channel}> has been activated. Please make sure you can receive DMs from me.`,
          ephemeral: true
        };
      }
      case 'off': {
        const channel = ctx.options.off.channel as string;

        const autoRecording = await this.prisma.autoRecord.findFirst({
          where: { guildId: ctx.guildID, clientId: this.client.bot.user.id, voiceChannelId: channel }
        });

        if (autoRecording) {
          await this.autoRecord.delete(autoRecording);
        } else {
          return {
            content: `No auto-recording found on <#${channel}>.`,
            ephemeral: true
          };
        }

        return {
          content: `Auto-recording on <#${channel}> has been deactivated.`,
          ephemeral: true
        };
      }
      case 'prune': {
        const result = await this.prisma.autoRecord.deleteMany({
          where: {
            guildId: ctx.guildID,
            clientId: this.client.bot.user.id,
            voiceChannelId: { notIn: guild.channels.map((c) => c.id) }
          }
        });

        return {
          content: `Pruned ${result.count} auto-record rules for non-existent channels.`,
          ephemeral: true
        };
      }
    }

    return {
      content: 'Unknown sub-command.',
      ephemeral: true
    };
  }
}
