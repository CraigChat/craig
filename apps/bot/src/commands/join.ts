import { ButtonStyle, CommandContext, CommandOptionType, ComponentType, EditMessageOptions, SlashCreator } from 'slash-create';

import Recording, { RecordingState } from '../modules/recorder/recording.js';
import { checkMaintenance, processCooldown } from '../redis.js';
import { reportRecordingError } from '../sentry.js';
import GeneralCommand from '../slashCommand.js';
import {
  checkBan,
  checkRecordingPermission,
  cutoffText,
  getSelfMember,
  isChannelNotFull,
  makeDownloadMessage,
  parseRewards,
  stripIndentsAndLines
} from '../util.js';

export default class Join extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'join',
      description: 'Start recording in a voice channel.',
      dmPermission: false,
      options: [
        {
          type: CommandOptionType.CHANNEL,
          name: 'channel',
          description: 'The voice channel to record in.',
          channel_types: [2, 13]
        }
      ]
    });
  }

  async reportError(ctx: CommandContext, error: Error, recording: Recording) {
    reportRecordingError(ctx, error, recording);
    const [t] = this.createT(ctx);

    const errorMessage: EditMessageOptions = {
      embeds: [
        {
          color: 0xe74c3c,
          title: t('recording.panel.error'),
          description: `${t('recording.start_error')}\n\n**${t('common.rec_id')}:** \`${recording.id}\``
        }
      ],
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.BUTTON,
              style: ButtonStyle.LINK,
              label: t('common.support_server'),
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
    const [t, locale] = this.createT(ctx);
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

    if (this.recorder.voiceTests.has(ctx.guildID))
      return {
        content: t('join_command.voice_test_ongoing'),
        ephemeral: true
      };

    const userCooldown = await processCooldown(`command:${ctx.user.id}:${this.client?.bot?.user?.id}`, 5, 3);
    if (userCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the join command, but was ratelimited.`
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
        content: t('recording.need_perms'),
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
    const member = guild.members.get(ctx.user.id) || (await guild.fetchMembers({ userIDs: [ctx.user.id] }))[0];

    // Check for existing recording
    if (this.recorder.recordings.has(ctx.guildID)) {
      const recording = this.recorder.recordings.get(ctx.guildID)!;
      if (recording.messageID && recording.messageChannelID) {
        const message = await this.client.bot.getMessage(recording.messageChannelID, recording.messageID).catch(() => null);
        if (message)
          return {
            content: t('join_command.exists'),
            ephemeral: true,
            components: [
              {
                type: ComponentType.ACTION_ROW,
                components: [
                  {
                    type: ComponentType.BUTTON,
                    style: ButtonStyle.LINK,
                    label: t('join_command.actions.jump_to_panel'),
                    url: `https://discord.com/channels/${ctx.guildID}/${recording.messageChannelID}/${recording.messageID}`,
                    emoji: this.emojis.getPartial('jump')
                  }
                ]
              }
            ]
          };
      }

      if (ctx.appPermissions && !ctx.appPermissions.has('EMBED_LINKS'))
        return {
          content: t('recording.need_embed', { channel: `<#${ctx.channelID}>` }),
          ephemeral: true
        };

      if (ctx.appPermissions && !ctx.appPermissions.has('VIEW_CHANNEL'))
        return {
          content: t('recording.need_view_channel', { channel: `<#${ctx.channelID}>` }),
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
        content: t('join_command.specify_channel'),
        ephemeral: true
      };
    if (channel!.type !== 2 && channel!.type !== 13)
      return {
        content: t('join_command.not_voice_channel'),
        ephemeral: true
      };

    // Check permissions
    if (!channel!.permissionsOf(this.client.bot.user.id).has('voiceConnect'))
      return {
        content: t('recording.cant_connect', { channel: `<#${channel!.id}>` }),
        ephemeral: true
      };
    if (!isChannelNotFull(channel!, this.client.bot.user.id))
      return {
        content: t('recording.channel_full', { channel: `<#${channel!.id}>` }),
        ephemeral: true
      };

    const nicknamePermission = ctx.appPermissions
      ? ctx.appPermissions.has('CHANGE_NICKNAME')
      : guild.permissionsOf(this.client.bot.user.id).has('changeNickname');
    if (!nicknamePermission)
      return {
        content: t('join_command.need_nick_perms'),
        ephemeral: true
      };

    if (ctx.appPermissions && !ctx.appPermissions.has('EMBED_LINKS'))
      return {
        content: t('recording.need_embed', { channel: `<#${ctx.channelID}>` }),
        ephemeral: true
      };

    if (ctx.appPermissions && !ctx.appPermissions.has('VIEW_CHANNEL'))
      return {
        content: t('recording.need_view_channel', { channel: `<#${ctx.channelID}>` }),
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
          content: `⚠️ __${t('join_command.maintenance')} ${t('common.try_again_later')}__\n\n${maintenence.message}`,
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
    }

    // Check guild-wide cooldown
    const guildCooldown = await processCooldown(`join:guild:${ctx.guildID}:${this.client?.bot?.user?.id}`, 30, 2);
    if (guildCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the join command, but was server-ratelimited. (${ctx.guildID})`
      );
      return {
        content: t('responses.ratelimited'),
        ephemeral: true
      };
    }

    // Get rewards
    const userData = await this.entitlements.getCurrentUser(ctx);
    const blessing = await this.prisma.blessing.findUnique({ where: { guildId: guild.id }, select: { userId: true } });
    const blessingUser = blessing ? await this.prisma.user.findUnique({ where: { id: blessing.userId }, select: { rewardTier: true } }) : null;
    const parsedRewards = parseRewards(this.recorder.client.config, userData?.rewardTier ?? 0, blessingUser?.rewardTier ?? 0);

    // Check if user can record
    if (parsedRewards.rewards.recordHours <= 0)
      return {
        content: `${t('join_command.supporter_only')}\n${t('responses.supporter_required', {
          dashboard_url: 'https://my.craig.chat/'
        })}`,
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
                label: t('common.supporter_cta'),
                url: 'https://craig.chat/supporter'
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
        content: t('join_command.cant_dm'),
        ephemeral: true
      };
    }

    // Nickname the bot
    const selfUser = await getSelfMember(guild, this.client.bot);
    const recNick = cutoffText(`![RECORDING] ${selfUser ? (selfUser.nick ?? selfUser.username) : this.client.bot.user.username}`, 32);
    await ctx.defer();
    let nickChanged = false;
    if (selfUser && (!selfUser.nick || !selfUser.nick.includes('[RECORDING]')))
      try {
        const nickWarnTimeout = setTimeout(() => {
          if (!nickChanged) ctx.editOriginal(t('join_command.nick_changing'));
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
        return t('join_command.nick_error');
      }

    // Start recording
    const recording = new Recording(this.recorder, channel as any, member.user, t, locale);
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
        content: t('join_command.started', { channel: `<#${channel!.id}>` }),
        ephemeral: true,
        components: [
          {
            type: ComponentType.ACTION_ROW,
            components: [
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.LINK,
                label: t('join_command.actions.jump_to_dm'),
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
          ${t('join_command.started', { channel: `<#${channel!.id}>` })}
          ${t('join_command.dm_unavailable')}

          **${t('common.rec_id')}:** \`${recording.id}\`
          **${t('common.delete_key')}:** ||\`${recording.deleteKey}\`|| ${t('common.click_to_show')}
          ${
            recording.webapp
              ? `**${t('common.webapp_url')}:** ${this.client.config.craig.webapp.connectUrl.replace('{id}', recording.id).replace('{key}', recording.ennuiKey)}`
              : ''
          }

          ${t('join_command.cant_dm_footer')}
        `,
        ephemeral: true,
        components: [
          {
            type: ComponentType.ACTION_ROW,
            components: [
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.LINK,
                label: t('common.download'),
                url: `https://${this.client.config.craig.downloadDomain}/rec/${recording.id}?key=${recording.accessKey}`,
                emoji: this.emojis.getPartial('download') || undefined
              },
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.LINK,
                label: t('join_command.delete_recording'),
                url: `https://${this.client.config.craig.downloadDomain}/rec/${recording.id}?key=${recording.accessKey}&delete=${recording.deleteKey}`,
                emoji: this.emojis.getPartial('delete') || undefined
              }
            ]
          }
        ]
      });
  }
}
