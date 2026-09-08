import { ButtonStyle, CommandContext, ComponentType } from 'slash-create';

import VoiceTest from '../modules/recorder/voiceTest.js';
import { processCooldown } from '../redis.js';
import GeneralCommand from '../slashCommand.js';
import { checkBan, checkRecordingPermission, isChannelNotFull, mainBotCommandOnly } from '../util.js';

export default class VoiceTestCommand extends GeneralCommand {
  constructor(creator: any) {
    super(creator, {
      name: 'voice-test',
      description: 'Easily test your audio quality in a voice channel.',
      dmPermission: false,
      guildIDs: mainBotCommandOnly
    });
  }

  async run(ctx: CommandContext) {
    const [t] = this.createT(ctx);
    if (!ctx.guildID) return { content: t('responses.guild_only'), ephemeral: true };
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
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the join command, but was ratelimited.`
      );
      return { content: t('responses.ratelimited'), ephemeral: true };
    }

    const vtCooldown = await this.redis.get(`cooldown:voice-test:${ctx.user.id}`);
    if (vtCooldown) {
      return {
        content: t('voicetest.ratelimited'),
        ephemeral: true
      };
    }

    const guildData = await this.prisma.guild.findUnique({ where: { id: ctx.guildID } });
    const hasPermission = checkRecordingPermission(ctx.member!, guildData);
    if (!hasPermission)
      return {
        content: t('voicetest.need_perms'),
        components: [
          {
            type: ComponentType.ACTION_ROW,
            components: [
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.LINK,
                label: t('voicetest.how_fix'),
                url: 'https://docs.craig.chat/features/access-roles/'
              }
            ]
          }
        ],
        ephemeral: true
      };

    // Check for existing recording or voice test
    if (this.recorder.recordings.has(ctx.guildID) || this.recorder.voiceTests.has(ctx.guildID)) {
      return {
        content: t('responses.recording_in_progress'),
        ephemeral: true
      };
    }

    // Get member from guild
    const member = guild.members.get(ctx.user.id) || (await guild.fetchMembers({ userIDs: [ctx.user.id] }))[0];

    // Check channel
    const channel = member.voiceState.channelID ? guild.channels.get(member.voiceState.channelID) : null;
    if (!channel || (channel.type !== 2 && channel.type !== 13))
      return {
        content: t('voicetest.not_in_channel'),
        ephemeral: true
      };

    // Check permissions
    if (!channel.permissionsOf(this.client.bot.user.id).has('voiceConnect'))
      return {
        content: t('recording.cant_connect', { channel: `<#${channel!.id}>` }),
        ephemeral: true
      };
    if (!isChannelNotFull(channel, this.client.bot.user.id))
      return {
        content: t('recording.channel_full', { channel: `<#${channel!.id}>` }),
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

    // Set cooldown
    await this.redis.setex(`cooldown:voice-test:${ctx.user.id}`, 10, '1');

    await ctx.defer();

    // Create voice test
    const voiceTest = new VoiceTest(this.recorder, ctx.guildID, channel as any, member.user, t);
    this.recorder.voiceTests.set(ctx.guildID, voiceTest);

    const { messageID, err } = await ctx
      .editOriginal(voiceTest.messageContent() as any)
      .then((m) => ({ err: null, messageID: m.id }))
      .catch((e) => ({ err: e, messageID: null }));

    if (err) {
      this.client.commands.logger.error(
        `Failed to edit message while starting voice test in ${guild.name} (${guild.id}) (${ctx.user.username}#${ctx.user.discriminator}, ${ctx.user.id})`,
        err
      );
      this.recorder.voiceTests.delete(ctx.guildID);
      return { content: t('recording.error'), ephemeral: true };
    }

    if (!messageID) {
      this.recorder.voiceTests.delete(ctx.guildID);
      return { content: t('common.could_not_message'), ephemeral: true };
    }

    voiceTest.messageID = messageID;
    voiceTest.messageChannelID = ctx.channelID;

    // Start the voice test
    const error = await voiceTest
      .start(ctx.channelID, messageID)
      .then(() => false)
      .catch((e) => e);

    if (error !== false) {
      this.client.commands.logger.error(
        `Failed to start voice test in ${guild.name} (${guild.id}) (${ctx.user.username}#${ctx.user.discriminator}, ${ctx.user.id})`,
        error
      );
      this.recorder.voiceTests.delete(ctx.guildID);
      await ctx.editOriginal({
        components: [
          {
            type: ComponentType.TEXT_DISPLAY,
            content: t('recording.error')
          }
        ]
      });
      return;
    }
  }
}
