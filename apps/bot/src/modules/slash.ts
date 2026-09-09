import { prisma } from '@craig/db';
import type { DAVESession } from '@snazzah/davey';
import { EmojiManager } from '@snazzah/emoji-sync';
import {
  AnyComponent,
  ButtonStyle,
  ComponentActionRow,
  ComponentContext,
  ComponentType,
  GatewayServer,
  MessageFlags,
  SlashCreator,
  SlashCreatorOptions,
  TextInputStyle
} from 'slash-create';

import type { CraigBot } from '../bot.js';
import AutorecordCommand from '../commands/autorecord.js';
import BlessCommand from '../commands/bless.js';
import BotProfileCommand from '../commands/botprofile.js';
import FeaturesCommand from '../commands/features.js';
import InfoCommand from '../commands/info.js';
import JoinCommand from '../commands/join.js';
import NoteCommand from '../commands/note.js';
import RecordingsCommand from '../commands/recordings.js';
import ServerSettingsCommand from '../commands/serversettings.js';
import StopCommand from '../commands/stop.js';
import UnblessCommand from '../commands/unbless.js';
import VoiceTestCommand from '../commands/voice-test.js';
import WebappCommand from '../commands/webapp.js';
import { createCtxT } from '../i18n.js';
import { BotModule } from '../runtime.js';
import { reportErrorFromCommand } from '../sentry.js';
import { blessServer, checkRecordingPermission, cutoffText, disableComponents, formatVoiceCode, paginateRecordings, unblessServer } from '../util.js';
import type RecorderModule from './recorder/index.js';
import { RecordingState } from './recorder/recording.js';

export interface SlashModuleOptions {
  creator?: Partial<SlashCreatorOptions>;
}

const commandConstructors = [
  AutorecordCommand,
  BlessCommand,
  BotProfileCommand,
  FeaturesCommand,
  InfoCommand,
  JoinCommand,
  NoteCommand,
  RecordingsCommand,
  ServerSettingsCommand,
  StopCommand,
  UnblessCommand,
  VoiceTestCommand,
  WebappCommand
];

export default class SlashModule extends BotModule {
  creator: SlashCreator;
  emojis: EmojiManager<
    'addnote' | 'check' | 'craig' | 'delete' | 'download' | 'e2ee' | 'jump' | 'next' | 'playingaudio' | 'prev' | 'remove' | 'stop'
  >;
  private interactionHandler?: (event: any) => void;

  constructor(client: CraigBot) {
    super(client, {
      name: 'slash',
      description: 'Slash command handler'
    });

    this.creator = new SlashCreator({
      ...(this.client.config.slash?.creator ?? {}),
      token: this.client.config.token,
      applicationID: this.client.config.applicationID,
      client
    });
    this.emojis = new EmojiManager({
      token: this.client.config.token,
      applicationId: this.client.config.applicationID
    });
  }

  async load() {
    this.creator.withServer(
      new GatewayServer((handler) => {
        this.interactionHandler = (event: any) => {
          if (event.t === 'INTERACTION_CREATE') handler(event.d as any);
        };
        this.client.bot.on('rawWS', this.interactionHandler);
      })
    );
    for (const Command of commandConstructors) this.creator.registerCommand(new Command(this.creator));

    this.creator.on('warn', (message) => this.logger.warn(message));
    this.creator.on('error', (error) => this.logger.error(error.stack || error.toString()));
    this.creator.on('commandRun', (command, _, ctx) => {
      this.client.metrics.onCommandRan(command.commandName);
      this.logger.info(`${ctx.user.username} (${ctx.user.id}) ran command /${command.commandName} ${ctx.subcommands.join(' ')}`);
    });
    this.creator.on('commandError', (command, error, ctx) => {
      reportErrorFromCommand(ctx, error, command.commandName, 'command');
      this.logger.error(`Command ${command.commandName} errored:`, error.stack || error.toString());
    });
    this.creator.on('componentInteraction', async (ctx) => {
      if (ctx.customID.startsWith('rec:')) await this.handleRecordingInteraction(ctx);
      else if (ctx.customID.startsWith('voicetest:')) await this.handleVoiceTestInteraction(ctx);
      else if (ctx.customID.startsWith('user:')) await this.handleUserInteraction(ctx);
    });

    if (process.env.EMOJI_SYNC_DATA) {
      this.emojis.loadFromDiscord(JSON.parse(process.env.EMOJI_SYNC_DATA));
      this.logger.debug('Loaded emojis from shard manager');
    } else {
      await this.emojis.loadFromFolder(this.client.config.assets.emojiFolder);
      await this.emojis.sync();
    }
    this.emojis.on('warn', (message) => this.logger.warn('[emoji] ' + message));
    this.emojis.on('error', (error) => this.logger.error('[emoji] ' + (error.stack || error.toString())));
  }

  get recorder(): RecorderModule {
    return this.client.recorder;
  }

  unload() {
    if (this.interactionHandler) this.client.bot.removeListener('rawWS', this.interactionHandler);
  }

  get config() {
    return this.client.config.slash;
  }

  async handleRecordingInteraction(ctx: ComponentContext) {
    const [t] = createCtxT(ctx);
    const [, recordingID, action] = ctx.customID.split(':');
    const recording = this.recorder.find(recordingID);
    if (!recording) {
      await ctx.editParent({ components: disableComponents(ctx.message.components as ComponentActionRow[]) });
      return ctx.send({
        content: t('recording.not_found'),
        ephemeral: true
      });
    }
    if (recording.channel.guild.id !== ctx.guildID) return;
    const hasPermission = checkRecordingPermission(ctx.member!, await prisma.guild.findUnique({ where: { id: ctx.guildID } }));
    if (!hasPermission && action !== 'e2ee' && action !== 'verificationcode')
      return ctx.send({
        content: t('recording.need_perms'),
        ephemeral: true
      });

    if (action === 'stop') {
      await recording.stop(false, ctx.user.id);
      await ctx.acknowledge();
    } else if (action === 'note') {
      await ctx.sendModal(
        {
          title: t('recording.note_modal.title'),
          components: [
            {
              type: ComponentType.ACTION_ROW,
              components: [
                {
                  type: ComponentType.TEXT_INPUT,
                  label: t('common.note'),
                  style: TextInputStyle.PARAGRAPH,
                  custom_id: 'note',
                  placeholder: t('recording.note_modal.placeholder')
                }
              ]
            }
          ]
        },
        (modalCtx) => {
          if (recording.state === RecordingState.ENDED || recording.state === RecordingState.ERROR)
            return modalCtx.send({
              content: t('recording.not_found'),
              ephemeral: true
            });
          try {
            recording.note((modalCtx.values.note as string) || '');
            recording.pushToActivity(
              `${t('recording.panel.added_note', { user: ctx.user.mention })}${
                modalCtx.values.note ? ` - ${cutoffText((modalCtx.values.note as string).replace(/\n/g, ' '), 100)}` : ''
              }`
            );
            return modalCtx.send({
              content: t('recording.added_note'),
              ephemeral: true
            });
          } catch (e) {
            recording.recorder.logger.error(`Error adding note to recording ${recordingID}:`, e);
            return modalCtx.send({
              content: t('recording.note_error'),
              ephemeral: true
            });
          }
        }
      );
    } else if (action === 'e2ee') {
      const inCall = recording.channel.voiceMembers.has(ctx.user.id);
      const vpc = recording.connection?.voicePrivacyCode;
      await ctx.send({
        flags: MessageFlags.IS_COMPONENTS_V2 + MessageFlags.EPHEMERAL,
        components: [
          {
            type: ComponentType.TEXT_DISPLAY,
            content: t('e2ee.header', { emoji: this.emojis.getMarkdown('e2ee') })
          },
          {
            type: ComponentType.SEPARATOR
          },
          ...((inCall
            ? [
                {
                  type: ComponentType.TEXT_DISPLAY,
                  content: `### ${t('e2ee.privacy_code')}\n${t('e2ee.code_since_time', {
                    time: `<t:${Math.floor(Date.now() / 1000)}:R>`
                  })}\n${vpc ? formatVoiceCode(vpc) : t('e2ee.unknown_code')}\n-# ${t('e2ee.footer')}\n`
                },
                {
                  type: ComponentType.ACTION_ROW,
                  components: [
                    {
                      type: ComponentType.BUTTON,
                      style: ButtonStyle.SECONDARY,
                      label: t('e2ee.view_verification_code'),
                      custom_id: `rec:${recording.id}:verificationcode`
                    }
                  ]
                }
              ]
            : [
                {
                  type: ComponentType.TEXT_DISPLAY,
                  content: `-# ${t('e2ee.cant_view_code')}`
                }
              ]) as AnyComponent[])
        ]
      });
    } else if (action === 'verificationcode') {
      if (!recording.channel.voiceMembers.has(ctx.user.id))
        await ctx.send({
          content: t('e2ee.not_in_channel'),
          ephemeral: true
        });
      else {
        try {
          const verificationCode = await (recording.connection?.daveSession as DAVESession)?.getVerificationCode(ctx.user.id);
          await ctx.send({
            content: `### ${t('e2ee.verification_code')}\n${t('e2ee.code_since_time', {
              time: `<t:${Math.floor(Date.now() / 1000)}:R>`
            })}\n${formatVoiceCode(verificationCode, 3)}`,
            ephemeral: true
          });
        } catch {
          await ctx.send({
            content: t('e2ee.verification_code_error'),
            ephemeral: true
          });
        }
      }
    }
  }

  async handleVoiceTestInteraction(ctx: ComponentContext) {
    const [t] = createCtxT(ctx);
    const [, action] = ctx.customID.split(':');
    const voiceTest = this.recorder.voiceTests.get(ctx.guildID!);
    if (!voiceTest) {
      await ctx.editParent({ components: disableComponents(ctx.message.components as ComponentActionRow[]) });
      return ctx.send({
        content: t('voicetest.not_found'),
        ephemeral: true
      });
    }

    const hasPermission = checkRecordingPermission(ctx.member!, await prisma.guild.findUnique({ where: { id: ctx.guildID } }));
    if (!hasPermission)
      return ctx.send({
        content: t('voicetest.need_perms'),
        ephemeral: true
      });

    if (action === 'stop') {
      await voiceTest.stopRecording();
      await ctx.acknowledge();
    } else if (action === 'cancel') {
      await voiceTest.cancel();
      await ctx.acknowledge();
    }
  }

  async handleUserInteraction(ctx: ComponentContext) {
    const [t] = createCtxT(ctx);
    const [, action, ...args] = ctx.customID.split(':');
    if (ctx.message.interaction!.user.id !== ctx.user.id)
      return ctx.send({
        content: t('responses.not_your_button'),
        ephemeral: true
      });

    switch (action) {
      case 'bless': {
        const [guildID] = args;
        try {
          await ctx.editParent({ components: [] });
          await ctx.send(await blessServer(ctx.user.id, guildID, this.emojis, t));
        } catch (e) {
          this.logger.error(`Error blessing server ${guildID}:`, e);
          await ctx.send({
            content: t('blessing.bless_error'),
            ephemeral: true
          });
        }
        return;
      }
      case 'unbless': {
        const [guildID] = args;
        try {
          await ctx.editParent({ components: [] });
          await ctx.send(await unblessServer(ctx.user.id, guildID, t));
        } catch (e) {
          this.logger.error(`Error unblessing server ${guildID}:`, e);
          await ctx.send({
            content: t('blessing.unbless_error'),
            ephemeral: true
          });
        }
        return;
      }
      case 'recordings': {
        const [page] = args;
        try {
          await ctx.editParent(await paginateRecordings(this.client as any, ctx.user.id, parseInt(page)));
        } catch (e) {
          this.logger.error(`Error paginating recordings for user ${ctx.user.id}:`, e);
          await ctx.send({
            content: t('responses.interaction_error'),
            ephemeral: true
          });
        }
        return;
      }
    }
  }
}
