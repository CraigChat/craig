import { oneLine, stripIndents } from 'common-tags';
import { ButtonStyle, CommandContext, CommandOptionType, ComponentType, EditMessageOptions, SlashCreator } from 'slash-create';

import Recording, { RecordingState } from '../modules/recorder/recording';
import { checkMaintenance, processCooldown } from '../redis';
import { reportRecordingError } from '../sentry';
import GeneralCommand from '../slashCommand';
import { checkBan, checkRecordingPermission, cutoffText, getSelfMember, makeDownloadMessage, parseRewards, stripIndentsAndLines } from '../util';

export default class Join extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'join',
      description: 'Start recording in a channel.',
      dmPermission: false,
      options: [
        {
          type: CommandOptionType.CHANNEL,
          name: 'channel',
          description: 'The channel to record in.',
          channel_types: [2, 13]
        }
      ]
    });

    this.filePath = __filename;
  }

  async reportError(ctx: CommandContext, error: Error, recording: Recording) {
    reportRecordingError(ctx, error, recording);

    const errorMessage: EditMessageOptions = {
      embeds: [
        {
          color: 0xe74c3c,
          title: 'An error occurred.',
          description: stripIndents`
            An error occurred while trying to start the recording. Try again in a few minutes.
            If this problem persists, please join the support server by clicking button below.

            **Recording ID:** \`${recording.id}\`
          `
        }
      ],
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.BUTTON,
              style: ButtonStyle.LINK,
              label: 'Support Server',
              url: 'https://discord.com/invite/PEc4QBE45f'
            }
          ]
        }
      ]
    };

    recording.state = RecordingState.ERROR;
    await recording.stop(true).catch(() => {});
    await ctx
      .editOriginal(errorMessage)
      .catch(() => ctx.send({ ...errorMessage, ephemeral: true }))
      .catch(() => {});
  }

  async run(ctx: CommandContext) {
    if (!ctx.guildID) return 'This command can only be used in a guild.';
    const guild = this.client.bot.guilds.get(ctx.guildID);

    if (!guild)
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

    if (await checkBan(ctx.user.id))
      return {
        content: 'You are not allowed to use the bot at this time.',
        ephemeral: true
      };

    const userCooldown = await processCooldown(`command:${ctx.user.id}`, 5, 3);
    if (userCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the join command, but was ratelimited.`
      );
      return {
        content: 'You are running commands too often! Try again in a few seconds.',
        ephemeral: true
      };
    }

    const guildData = await this.prisma.guild.findFirst({ where: { id: ctx.guildID } });
    const hasPermission = checkRecordingPermission(ctx.member!, guildData);
    if (!hasPermission)
      return {
        content: 'You need the `Manage Server` permission or have an access role to manage recordings.',
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
    const member = guild.members.get(ctx.user.id) || (await guild.fetchMembers({ userIDs: [ctx.user.id] }))[0];

    // Check for existing recording
    if (this.recorder.recordings.has(ctx.guildID)) {
      const recording = this.recorder.recordings.get(ctx.guildID)!;
      if (recording.messageID && recording.messageChannelID) {
        const message = await this.client.bot.getMessage(recording.messageChannelID, recording.messageID).catch(() => null);
        if (message)
          return {
            content: 'Already recording in this guild.',
            ephemeral: true,
            components: [
              {
                type: ComponentType.ACTION_ROW,
                components: [
                  {
                    type: ComponentType.BUTTON,
                    style: ButtonStyle.LINK,
                    label: 'Jump to recording panel',
                    url: `https://discordapp.com/channels/${ctx.guildID}/${recording.messageChannelID}/${recording.messageID}`,
                    emoji: this.emojis.getPartial('jump')
                  }
                ]
              }
            ]
          };
      }

      if (ctx.appPermissions && !ctx.appPermissions.has('EMBED_LINKS'))
        return {
          content: `I need the \`Embed Links\` permission to be able to display my recording panel.`,
          ephemeral: true
        };

      if (ctx.appPermissions && !ctx.appPermissions.has('VIEW_CHANNEL'))
        return {
          content: `I need the \`View Channel\` permission in <#${ctx.channelID}> to be able to display my recording panel.`,
          ephemeral: true
        };

      await ctx.send(recording.messageContent() as any);
      const { id: messageID } = await ctx.fetch();
      recording.messageID = messageID;
      recording.messageChannelID = ctx.channelID;
      return;
    }

    // Check channel
    let channel = guild.channels.get(ctx.options.channel);
    if (!channel && member?.voiceState?.channelID) channel = guild.channels.get(member.voiceState.channelID);
    else if (!channel)
      return {
        content: 'Please specify a channel to record in, or join a channel.',
        ephemeral: true
      };
    if (channel!.type !== 2 && channel!.type !== 13)
      return {
        content: 'That channel is not a voice channel.',
        ephemeral: true
      };

    // Check permissions
    if (!channel!.permissionsOf(this.client.bot.user.id).has('voiceConnect'))
      return {
        content: `I do not have permission to connect to <#${channel!.id}>.`,
        ephemeral: true
      };

    const nicknamePermission = ctx.appPermissions
      ? ctx.appPermissions.has('CHANGE_NICKNAME')
      : guild.permissionsOf(this.client.bot.user.id).has('changeNickname');
    if (!nicknamePermission)
      return {
        content: 'I do not have permission to change my nickname. I will not record without this permission.',
        ephemeral: true
      };

    if (ctx.appPermissions && !ctx.appPermissions.has('EMBED_LINKS'))
      return {
        content: `I need the \`Embed Links\` permission to be able to display my recording panel.`,
        ephemeral: true
      };

    if (ctx.appPermissions && !ctx.appPermissions.has('VIEW_CHANNEL'))
      return {
        content: `I need the \`View Channel\` permission in <#${ctx.channelID}> to be able to display my recording panel.`,
        ephemeral: true
      };

    // Check for maintenence
    const isElevated = this.client.config.elevated
      ? Array.isArray(this.client.config.elevated)
        ? this.client.config.elevated.includes(ctx.user.id)
        : this.client.config.elevated === ctx.user.id
      : false;
    if (!isElevated) {
      const maintenence = await checkMaintenance(this.client.bot.user.id);
      if (maintenence)
        return {
          content: `⚠️ __The bot is currently undergoing maintenance. Please try again later.__\n\n${maintenence.message}`,
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

    // Check guild-wide cooldown
    const guildCooldown = await processCooldown(`join:guild:${ctx.guildID}`, 30, 2);
    if (guildCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the join command, but was server-ratelimited. (${ctx.guildID})`
      );
      return {
        content: 'This server is recording too often! Try again in a few seconds.',
        ephemeral: true
      };
    }

    // Get rewards
    const userData = await this.prisma.user.findFirst({ where: { id: ctx.user.id } });
    const blessing = await this.prisma.blessing.findFirst({ where: { guildId: guild.id } });
    const blessingUser = blessing ? await this.prisma.user.findFirst({ where: { id: blessing.userId } }) : null;
    const parsedRewards = parseRewards(this.recorder.client.config, userData?.rewardTier ?? 0, blessingUser?.rewardTier ?? 0);

    // Check if user can record
    if (parsedRewards.rewards.recordHours <= 0)
      return {
        content: stripIndentsAndLines`
          Sorry, but this bot is only for patrons. Please use Craig.
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
                label: 'craig.chat',
                url: 'https://craig.chat/'
              },
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

    // Check for DM permissions
    const dmChannel = await member.user.getDMChannel().catch(() => null);
    if (!dmChannel) {
      return {
        content: "I can't DM you, so I can't record. I need to be able to DM you to send you the download link.",
        ephemeral: true
      };
    }

    // Nickname the bot
    const selfUser = await getSelfMember(guild, this.client.bot);
    const recNick = cutoffText(`![RECORDING] ${selfUser ? selfUser.nick ?? selfUser.username : this.client.bot.user.username}`, 32);
    await ctx.defer();
    let nickChanged = false;
    if (selfUser && (!selfUser.nick || !selfUser.nick.includes('[RECORDING]')))
      try {
        const nickWarnTimeout = setTimeout(() => {
          if (!nickChanged)
            ctx.editOriginal(oneLine`
              It's taking a while for me to change my nickname to indicate that I'm recording.
              I cannot start recording until I've changed my nickname. Please be patient.
            `);
        }, 3000) as unknown as number;
        await this.client.bot.editGuildMember(ctx.guildID, '@me', { nick: recNick }, 'Setting recording status');
        nickChanged = true;
        clearTimeout(nickWarnTimeout);
      } catch (e) {
        nickChanged = true;
        this.client.commands.logger.warn(
          `Failed to change nickname for ${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) to record`,
          e
        );
        return `An error occurred while changing my nickname: ${e}`;
      }

    // Start recording
    const recording = new Recording(this.recorder, channel as any, member.user);
    this.recorder.recordings.set(ctx.guildID, recording);
    const { messageID, err } = await ctx
      .editOriginal(recording.messageContent() as any)
      .then((m) => ({ err: null, messageID: m.id }))
      .catch((e) => ({ err: e, messageID: null }));
    if (err) {
      this.client.commands.logger.error(
        `Failed to edit message while starting recording ${recording.id} (${guild.name}, ${guild.id}) (${ctx.user.username}#${ctx.user.discriminator}, ${ctx.user.id})`,
        err
      );
      await this.reportError(ctx, err, recording).catch(() => {});
      return;
    }

    recording.messageID = messageID;
    recording.messageChannelID = ctx.channelID;
    const error = await recording
      .start(parsedRewards, userData?.webapp ?? false)
      .then(() => false)
      .catch((e) => e);

    if (error !== false) {
      this.client.commands.logger.error(
        `Failed to start recording ${recording.id} (${guild.name}, ${guild.id}) (${ctx.user.username}#${ctx.user.discriminator}, ${ctx.user.id})`,
        error
      );
      await this.reportError(ctx, err, recording).catch(() => {});
      return;
    }

    // Send DM
    const dmMessage = await dmChannel.createMessage(makeDownloadMessage(recording, parsedRewards, this.client.config, this.emojis)).catch(() => null);

    if (dmMessage)
      await ctx.sendFollowUp({
        content: `Started recording in <#${channel!.id}>.`,
        ephemeral: true,
        components: [
          {
            type: ComponentType.ACTION_ROW,
            components: [
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.LINK,
                label: 'Jump to DM',
                url: `https://discord.com/channels/@me/${dmChannel.id}/${dmMessage.id}`,
                emoji: this.emojis.getPartial('jump') || undefined
              }
            ]
          }
        ]
      });
    else
      await ctx.sendFollowUp({
        content: stripIndentsAndLines`
          Started recording in <#${channel!.id}>.
          I was unable to send you a DM with the download link. I need to be able to DM you to send you the download link in the future.

          **Recording ID:** \`${recording.id}\`
          **Delete key:** ||\`${recording.deleteKey}\`|| (click to show)
          ${
            recording.webapp
              ? `**Webapp URL:** ${this.client.config.craig.webapp.connectUrl.replace('{id}', recording.id).replace('{key}', recording.ennuiKey)}`
              : ''
          }

          To bring up the recording link again, use the \`/recordings\` command.
        `,
        ephemeral: true,
        components: [
          {
            type: ComponentType.ACTION_ROW,
            components: [
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.LINK,
                label: 'Download',
                url: `https://${this.client.config.craig.downloadDomain}/rec/${recording.id}?key=${recording.accessKey}`,
                emoji: this.emojis.getPartial('download') || undefined
              },
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.LINK,
                label: 'Delete recording',
                url: `https://${this.client.config.craig.downloadDomain}/rec/${recording.id}?key=${recording.accessKey}&delete=${recording.deleteKey}`,
                emoji: this.emojis.getPartial('delete') || undefined
              }
            ]
          }
        ]
      });
  }
}
