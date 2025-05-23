import { oneLine, stripIndents } from 'common-tags';
import { ButtonStyle, CommandContext, CommandOptionType, ComponentType, EditMessageOptions, SlashCreator } from 'slash-create';

import Recording, { RecordingState } from '../modules/recorder/recording';
import { checkMaintenance, processCooldown } from '../redis';
import { reportRecordingError } from '../sentry';
import GeneralCommand from '../slashCommand';
import { checkRecordingPermission, cutoffText, getSelfMember, makeDownloadMessage, stripIndentsAndLines } from '../util';

export default class Join extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'join',
      description: 'Inicia uma gravação em um canal.',
      dmPermission: false,
      options: [
        {
          type: CommandOptionType.CHANNEL,
          name: 'canal',
          description: 'O canal para gravar.',
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
          title: 'Ocorreu um erro.',
          description: stripIndents`
            Ocorreu um erro ao iniciar a gravação.

            **Recording ID:** \`${recording.id}\`
          `
        }
      ],
      components: []
    };

    recording.state = RecordingState.ERROR;
    await recording.stop(true).catch(() => {});
    await ctx
      .editOriginal(errorMessage)
      .catch(() => ctx.send({ ...errorMessage, ephemeral: true }))
      .catch(() => {});
  }

  async run(ctx: CommandContext) {
    if (!ctx.guildID) return 'Esse comando deve ser usado em um servidor.';
    const guild = this.client.bot.guilds.get(ctx.guildID);

    if (!guild)
      return {
        content: 'Não consegui me conectar ao servidor.',
        ephemeral: true,
        components: []
      };

    const userCooldown = await processCooldown(`command:${ctx.user.id}`, 5, 3);
    if (userCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the join command, but was ratelimited.`
      );
      return {
        content: 'Espere alguns segundos antes de usar esse comando.',
        ephemeral: true
      };
    }

    const guildData = await this.prisma.guild.findFirst({ where: { id: ctx.guildID } });
    const hasPermission = checkRecordingPermission(ctx.member!, guildData);
    if (!hasPermission)
      return {
        content: 'Você não tem permissão de iniciar uma gravação.',
        components: [],
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
            content: 'Já existe uma gravação nesse servidor.',
            ephemeral: true,
            components: [
              {
                type: ComponentType.ACTION_ROW,
                components: [
                  {
                    type: ComponentType.BUTTON,
                    style: ButtonStyle.LINK,
                    label: 'Painel de gravação.',
                    url: `https://discordapp.com/channels/${ctx.guildID}/${recording.messageChannelID}/${recording.messageID}`,
                    emoji: { id: '949782524131942460' }
                  }
                ]
              }
            ]
          };
      }

      if ((ctx.appPermissions && !ctx.appPermissions.has('EMBED_LINKS')) || (ctx.appPermissions && !ctx.appPermissions.has('VIEW_CHANNEL')))
        return {
          content: `Estão faltando permissões para enviar o painel de gravação: 
                    São necessárias as permissões \`Embed Links\` e \`View Channel\` em <#${ctx.channelID}>.`,
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
        content: 'Especifique um canal ou entre em um canal de voz para iniciar uma gravação.',
        ephemeral: true
      };
    if (channel!.type !== 2 && channel!.type !== 13)
      return {
        content: 'Esse canal não é um canal de voz.',
        ephemeral: true
      };

    // Check permissions
    if (!channel!.permissionsOf(this.client.bot.user.id).has('voiceConnect'))
      return {
        content: `Eu não tenho permissão para entrar em <#${channel!.id}>.`,
        ephemeral: true
      };

    const nicknamePermission = ctx.appPermissions
      ? ctx.appPermissions.has('CHANGE_NICKNAME')
      : guild.permissionsOf(this.client.bot.user.id).has('changeNickname');
    if (!nicknamePermission)
      return {
        content: 'Eu preciso de permissão para alterar meu apelido.',
        ephemeral: true
      };

    if ((ctx.appPermissions && !ctx.appPermissions.has('EMBED_LINKS')) || (ctx.appPermissions && !ctx.appPermissions.has('VIEW_CHANNEL')))
      return {
        content: `Estão faltando permissões para enviar o painel de gravação: 
                  São necessárias as permissões \`Embed Links\` e \`View Channel\` em <#${ctx.channelID}>.`,
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
          content: `⚠️ __O bot está em manutenção.__\n\n${maintenence.message}`,
          ephemeral: true,
          components: []
        };
    }

    // Check guild-wide cooldown
    const guildCooldown = await processCooldown(`join:guild:${ctx.guildID}`, 30, 2);
    if (guildCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the join command, but was server-ratelimited. (${ctx.guildID})`
      );
      return {
        content: 'Aguarde alguns segundos antes de usar esse comando novamente.',
        ephemeral: true
      };
    }

    // Check for DM permissions
    const dmChannel = await member.user.getDMChannel().catch(() => null);
    if (!dmChannel) {
      return {
        content: "Preciso de permissão para enviar mensagens diretas. Não posso enviar o link de download.",
        ephemeral: true
      };
    }

    // Nickname the bot
    const selfUser = await getSelfMember(guild, this.client.bot);
    const recNick = cutoffText(`![GRAVANDO] ${selfUser ? selfUser.nick ?? selfUser.username : this.client.bot.user.username}`, 32);
    await ctx.defer();
    let nickChanged = false;
    if (selfUser && (!selfUser.nick || !selfUser.nick.includes('[GRAVANDO]')))
      try {
        const nickWarnTimeout = setTimeout(() => {
          if (!nickChanged)
            ctx.editOriginal(oneLine`
              Aguarde enquanto tento alterar meu apelido.
            `);
        }, 3000) as unknown as number;
        await this.client.bot.editGuildMember(ctx.guildID, '@me', { nick: recNick }, 'Trocando estado de gravação');
        nickChanged = true;
        clearTimeout(nickWarnTimeout);
      } catch (e) {
        nickChanged = true;
        this.client.commands.logger.warn(
          `Não consegui alterar meu apelido ${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) pra gravar`,
          e
        );
        return `Ocorreu um erro ao mudar meu apelido: ${e}`;
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

    // Send DM
    const dmMessage = await dmChannel.createMessage(makeDownloadMessage(recording, this.client.config)).catch(() => null);

    if (dmMessage)
      await ctx.sendFollowUp({
        content: `Gravação iniciada em <#${channel!.id}>.`,
        ephemeral: true,
        components: [
          {
            type: ComponentType.ACTION_ROW,
            components: [
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.LINK,
                label: 'Ir para mensagem direta.',
                url: `https://discord.com/channels/@me/${dmChannel.id}/${dmMessage.id}`,
                emoji: { id: '949782524131942460' }
              }
            ]
          }
        ]
      });
    else
      await ctx.sendFollowUp({
        content: stripIndentsAndLines`
          Gravação iniciada em <#${channel!.id}>.
          Não consegui enviar o link da gravação.

          **ID da gravação:** \`${recording.id}\`
          **Chave para deletar:** ||\`${recording.deleteKey}\`|| (click to show)

          Para mostrar o link da gravação novamente, use o comando \`/recordings\`.
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
                emoji: { id: '949825704923639828' }
              },
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.LINK,
                label: 'Deletar Gravação',
                url: `https://${this.client.config.craig.downloadDomain}/rec/${recording.id}?key=${recording.accessKey}&delete=${recording.deleteKey}`,
                emoji: { id: '949825704596500481' }
              }
            ]
          }
        ]
      });
  }
}
