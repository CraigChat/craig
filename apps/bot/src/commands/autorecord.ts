import { stripIndents } from 'common-tags';
import { ButtonStyle, ChannelType, CommandContext, CommandOptionType, ComponentType, SlashCreator } from 'slash-create';

import { processCooldown } from '../redis';
import GeneralCommand from '../slashCommand';
import { checkBan, checkRecordingPermission, parseRewards } from '../util';

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
              channel_types: [2, 13]
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
              name: 'mininum',
              description: 'The minimum amount of members to auto-record on. Set this to 0 to only auto-record by triggers.',
              min_value: 0,
              max_value: 99
            },
            {
              type: CommandOptionType.STRING,
              name: 'triggers',
              description: 'The members that trigger the auto-recording. Mention users inside this option.'
            },
            {
              type: CommandOptionType.CHANNEL,
              name: 'post-channel',
              description: 'The channel to post recording panels to when an auto-recording starts.',
              channel_types: [ChannelType.GUILD_TEXT]
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
        }
      ]
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    if (!ctx.guildID) return 'This command can only be used in a guild.';
    const guild = this.client.bot.guilds.get(ctx.guildID)!;

    if (await checkBan(ctx.user.id))
      return {
        content: 'You are not allowed to use the bot at this time.',
        ephemeral: true
      };

    const userCooldown = await processCooldown(`command:${ctx.user.id}`, 5, 3);
    if (userCooldown !== true)
      return {
        content: 'You are running commands too often! Try again in a few seconds.',
        ephemeral: true
      };

    const guildData = await this.prisma.guild.findFirst({ where: { id: ctx.guildID } });
    const hasPermission = checkRecordingPermission(ctx.member!, guildData);
    if (!hasPermission)
      return {
        content: 'You need the `Manage Server` permission or have an access role to manage auto-recordings.',
        ephemeral: true
      };

    switch (ctx.subcommands[0]) {
      case 'view': {
        if (ctx.options.view.channel) {
          const autoRecording = await this.prisma.autoRecord.findFirst({
            where: { guildId: ctx.guildID, clientId: this.client.bot.user.id, channelId: ctx.options.view.channel }
          });

          if (!autoRecording)
            return {
              content: 'That channel is not auto-recorded.',
              ephemeral: true
            };

          return {
            embeds: [
              {
                title: ctx.channels.get(ctx.options.view.channel)!.name ?? 'Unknown channel',
                description: stripIndents`
                  **Channel:** <#${ctx.options.view.channel}>
                  **Created by:** <@${autoRecording.userId}>
                  **Minimum members:** ${autoRecording.minimum === 0 ? 'N/A' : autoRecording.minimum.toLocaleString()}
                  **Trigger users:** ${autoRecording.triggerUsers.map((userId) => `<@${userId}>`).join(', ') || '*None*'}
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

        if (autoRecordings.length === 0)
          return {
            content: 'There are no auto-recorded channels.',
            ephemeral: true
          };

        return {
          embeds: [
            {
              title: 'Auto-recorded Channels',
              description: autoRecordings
                .map((ar) => {
                  const extra = [
                    ar.minimum !== 0 ? `${ar.minimum} minimum` : null,
                    ar.triggerUsers.length > 0 ? `${ar.triggerUsers.length} trigger users` : null,
                    ar.postChannelId ? `posting to <#${ar.postChannelId}>` : null
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
        const userData = await this.prisma.user.findFirst({ where: { id: ctx.user.id } });
        const blessing = await this.prisma.blessing.findFirst({ where: { guildId: guild.id } });
        const blessingUser = blessing ? await this.prisma.user.findFirst({ where: { id: blessing.userId } }) : null;
        const parsedRewards = parseRewards(this.recorder.client.config, userData?.rewardTier ?? 0, blessingUser?.rewardTier ?? 0);
        // Check if user can manage auto-recordings
        if (!parsedRewards.rewards.features.includes('auto'))
          return {
            content: stripIndents`
              Sorry, but this feature is only for patrons.
              If you have recently became a patron, login to the [dashboard](https://my.craig.chat/).
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

        const channel = ctx.options.on.channel as string;
        const min = ctx.options.on.mininum ?? 1;
        const triggerUsers = ctx.users.map((u) => u.id);
        const postChannel = ctx.options.on['post-channel'] as string;

        if (min === 0 && triggerUsers.length <= 0)
          return {
            content: "You can't set the minimum to 0 without any triggers.",
            ephemeral: true
          };

        const autoRecordingCount = await this.prisma.autoRecord.count({
          where: { guildId: ctx.guildID, clientId: this.client.bot.user.id }
        });

        if (autoRecordingCount >= 10)
          return {
            content: 'You can only have 10 auto-recordings at a time.',
            ephemeral: true
          };

        const autoRecording = await this.prisma.autoRecord.findFirst({
          where: { guildId: ctx.guildID, clientId: this.client.bot.user.id, channelId: channel }
        });

        if (autoRecording)
          await this.prisma.autoRecord.update({
            where: { id: autoRecording.id },
            data: { userId: ctx.user.id, minimum: min, triggerUsers: triggerUsers, postChannelId: postChannel || null }
          });
        else
          await this.prisma.autoRecord.create({
            data: {
              clientId: this.client.bot.user.id,
              guildId: ctx.guildID,
              channelId: channel,
              userId: ctx.user.id,
              postChannelId: postChannel || null,
              minimum: min,
              triggerUsers: triggerUsers
            }
          });

        return {
          content: `Auto-recording on <#${channel}> has been activated. Please make sure you can receive DMs from me.`,
          ephemeral: true
        };
      }
      case 'off': {
        const channel = ctx.options.off.channel as string;

        const autoRecording = await this.prisma.autoRecord.findFirst({
          where: { guildId: ctx.guildID, clientId: this.client.bot.user.id, channelId: channel }
        });

        if (autoRecording)
          await this.prisma.autoRecord.delete({
            where: { id: autoRecording.id }
          });
        else
          return {
            content: `No auto-recording found on <#${channel}>.`,
            ephemeral: true
          };

        return {
          content: `Auto-recording on <#${channel}> has been deactivated.`,
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
