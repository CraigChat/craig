import { ButtonStyle, CommandContext, ComponentType } from 'slash-create';

import VoiceTest from '../modules/recorder/voiceTest';
import { processCooldown } from '../redis';
import GeneralCommand from '../slashCommand';
import { checkBan, checkRecordingPermission, mainBotCommandOnly } from '../util';

export default class VoiceTestCommand extends GeneralCommand {
  constructor(creator: any) {
    super(creator, {
      name: 'voice-test',
      description: 'Easily test your audio quality in a voice channel.',
      dmPermission: false,
      guildIDs: mainBotCommandOnly
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    if (!ctx.guildID) return { content: 'This command can only be used in a guild.', ephemeral: true };
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

    const userCooldown = await processCooldown(`command:${ctx.user.id}:${this.client?.bot?.user?.id}`, 5, 3);
    if (userCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the join command, but was ratelimited.`
      );
      return {
        content: 'You are running commands too often! Try again in a few seconds.',
        ephemeral: true
      };
    }

    const vtCooldown = await this.redis.get(`cooldown:voice-test:${ctx.user.id}`);
    if (vtCooldown) {
      return {
        content: 'You are doing voice tests too often! Try again in a few seconds.',
        ephemeral: true
      };
    }

    const guildData = await this.prisma.guild.findFirst({ where: { id: ctx.guildID } });
    const hasPermission = checkRecordingPermission(ctx.member!, guildData);
    if (!hasPermission)
      return {
        content: 'You need the `Manage Server` permission or have an access role to do a voice test.',
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

    // Check for existing recording or voice test
    if (this.recorder.recordings.has(ctx.guildID) || this.recorder.voiceTests.has(ctx.guildID)) {
      return {
        content: 'A recording or voice test is already in progress in this server.',
        ephemeral: true
      };
    }

    // Get member from guild
    const member = guild.members.get(ctx.user.id) || (await guild.fetchMembers({ userIDs: [ctx.user.id] }))[0];

    // Check channel
    const channel = member.voiceState.channelID ? guild.channels.get(member.voiceState.channelID) : null;
    if (!channel || (channel.type !== 2 && channel.type !== 13))
      return {
        content: 'You need to be in a voice channel to do a voice test.',
        ephemeral: true
      };

    // Check permissions
    if (!channel.permissionsOf(this.client.bot.user.id).has('voiceConnect'))
      return {
        content: `I do not have permission to connect to <#${channel!.id}>.`,
        ephemeral: true
      };

    if (ctx.appPermissions && !ctx.appPermissions.has('EMBED_LINKS'))
      return {
        content: `I need the \`Embed Links\` permission to be able to display the voice test.`,
        ephemeral: true
      };

    if (ctx.appPermissions && !ctx.appPermissions.has('VIEW_CHANNEL'))
      return {
        content: `I need the \`View Channel\` permission in <#${ctx.channelID}> to be able to display my voice test panel.`,
        ephemeral: true
      };

    // Set cooldown
    await this.redis.setex(`cooldown:voice-test:${ctx.user.id}`, 10, '1');

    await ctx.defer();

    // Create voice test
    const voiceTest = new VoiceTest(this.recorder, ctx.guildID, channel as any, member.user);
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
      return { content: 'An error occurred while starting the voice test, try again later.', ephemeral: true };
    }

    if (!messageID) {
      this.recorder.voiceTests.delete(ctx.guildID);
      return { content: 'Failed to create voice test message.', ephemeral: true };
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
            content: 'An error occurred while starting the voice test. Please try again later.'
          }
        ]
      });
      return;
    }
  }
}
