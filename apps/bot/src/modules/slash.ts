import type { DAVESession } from '@snazzah/davey';
import { EmojiManager } from '@snazzah/emoji-sync';
import { BaseConfig, DexareClient, DexareModule } from 'dexare';
import path from 'node:path';
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

import type { CraigBotConfig } from '../bot';
import { onCommandRun } from '../influx';
import { prisma } from '../prisma';
import { reportErrorFromCommand } from '../sentry';
import { blessServer, checkRecordingPermission, cutoffText, disableComponents, formatVoiceCode, paginateRecordings, unblessServer } from '../util';
import type RecorderModule from './recorder';
import { RecordingState } from './recorder/recording';

export interface SlashConfig extends BaseConfig {
  applicationID: string;
  slash?: SlashModuleOptions;
}

export interface SlashModuleOptions {
  creator?: SlashCreatorOptions;
}

export default class SlashModule<T extends DexareClient<SlashConfig>> extends DexareModule<T> {
  creator: SlashCreator;
  emojis: EmojiManager<
    'addnote' | 'check' | 'craig' | 'delete' | 'download' | 'e2ee' | 'jump' | 'next' | 'playingaudio' | 'prev' | 'remove' | 'stop'
  >;

  constructor(client: T) {
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
    this.filePath = __filename;
  }

  async load() {
    await this.creator
      .withServer(
        new GatewayServer((handler) =>
          this.registerEvent('rawWS', (_, event) => {
            if (event.t === 'INTERACTION_CREATE') handler(event.d as any);
          })
        )
      )
      .registerCommandsIn(path.join(__dirname, '../commands'));

    this.creator.on('warn', (message) => this.logger.warn(message));
    this.creator.on('error', (error) => this.logger.error(error.stack || error.toString()));
    this.creator.on('commandRun', (command, _, ctx) => {
      onCommandRun(ctx.user.id, command.commandName, ctx.guildID);
      this.logger.info(`${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) ran command ${command.commandName}`);
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
      this.logger.info('Loaded emojis from shard manager');
    } else {
      await this.emojis.loadFromFolder(path.join(__dirname, '../../emojis'));
      await this.emojis.sync();
    }
    this.emojis.on('warn', (message) => this.logger.warn('[emoji] ' + message));
    this.emojis.on('error', (error) => this.logger.error('[emoji] ' + (error.stack || error.toString())));
  }

  get recorder(): RecorderModule<DexareClient<CraigBotConfig>> {
    return this.client.modules.get('recorder') as RecorderModule<any>;
  }

  unload() {
    this.unregisterAllEvents();
  }

  get config() {
    return this.client.config.slash;
  }

  async handleRecordingInteraction(ctx: ComponentContext) {
    const [, recordingID, action] = ctx.customID.split(':');
    const recording = this.recorder.find(recordingID);
    if (!recording) {
      await ctx.editParent({ components: disableComponents(ctx.message.components as ComponentActionRow[]) });
      return ctx.send({
        content: 'That recording was not found or may have already ended.',
        ephemeral: true
      });
    }
    if (recording.channel.guild.id !== ctx.guildID) return;
    const hasPermission = checkRecordingPermission(ctx.member!, await prisma.guild.findFirst({ where: { id: ctx.guildID } }));
    if (!hasPermission && action !== 'e2ee' && action !== 'verificationcode')
      return ctx.send({
        content: 'You need the `Manage Server` permission or have an access role to manage recordings.',
        ephemeral: true
      });

    if (action === 'stop') {
      await recording.stop(false, ctx.user.id);
      await ctx.acknowledge();
    } else if (action === 'note') {
      await ctx.sendModal(
        {
          title: 'Add a note to this recording',
          components: [
            {
              type: ComponentType.ACTION_ROW,
              components: [
                {
                  type: ComponentType.TEXT_INPUT,
                  label: 'Note',
                  style: TextInputStyle.PARAGRAPH,
                  custom_id: 'note',
                  placeholder: 'Chapter 1, Part 1, etc.'
                }
              ]
            }
          ]
        },
        (modalCtx) => {
          if (recording.state === RecordingState.ENDED || recording.state === RecordingState.ERROR)
            return modalCtx.send({
              content: 'That recording was not found or may have already ended.',
              ephemeral: true
            });
          try {
            recording.note((modalCtx.values.note as string) || '');
            recording.pushToActivity(
              `${ctx.user.mention} added a note.${
                modalCtx.values.note ? ` - ${cutoffText((modalCtx.values.note as string).replace(/\n/g, ' '), 100)}` : ''
              }`
            );
            return modalCtx.send({
              content: 'Added the note to the recording!',
              ephemeral: true
            });
          } catch (e) {
            recording.recorder.logger.error(`Error adding note to recording ${recordingID}:`, e);
            return modalCtx.send({
              content: 'An error occurred while adding the note.',
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
            content: `This voice call is ${this.emojis.getMarkdown(
              'e2ee'
            )} **end-to-end encrypted**, [Learn more here](https://support.discord.com/hc/en-us/articles/25968222946071-End-to-End-Encryption-for-Audio-and-Video).`
          },
          {
            type: ComponentType.SEPARATOR
          },
          ...((inCall
            ? [
                {
                  type: ComponentType.TEXT_DISPLAY,
                  content: `### Voice Privacy Code\nSince <t:${Math.floor(Date.now() / 1000)}:R>\n${
                    vpc ? formatVoiceCode(vpc) : 'Unknown (might be transitioning the call, try again later)'
                  }\n-# A new code is generated when people join or leave this call.\n`
                },
                {
                  type: ComponentType.ACTION_ROW,
                  components: [
                    {
                      type: ComponentType.BUTTON,
                      style: ButtonStyle.SECONDARY,
                      label: 'View Verification Code',
                      custom_id: `rec:${recording.id}:verificationcode`
                    }
                  ]
                }
              ]
            : [
                {
                  type: ComponentType.TEXT_DISPLAY,
                  content: "-# You aren't in this voice channel right now to be able to view the privacy code."
                }
              ]) as AnyComponent[])
        ]
      });
    } else if (action === 'verificationcode') {
      if (!recording.channel.voiceMembers.has(ctx.user.id))
        await ctx.send({
          content: "You aren't in this channel.",
          ephemeral: true
        });
      else {
        try {
          const verificationCode = await (recording.connection?.daveSession as DAVESession)?.getVerificationCode(ctx.user.id);
          await ctx.send({
            content: `### Verification Code\nSince <t:${Math.floor(Date.now() / 1000)}:R>\n${formatVoiceCode(verificationCode, 3)}`,
            ephemeral: true
          });
        } catch {
          await ctx.send({
            content: 'An error occurred when trying to get the verification code, try again later.',
            ephemeral: true
          });
        }
      }
    }
  }

  async handleVoiceTestInteraction(ctx: ComponentContext) {
    const [, action] = ctx.customID.split(':');
    const voiceTest = this.recorder.voiceTests.get(ctx.guildID!);
    if (!voiceTest) {
      await ctx.editParent({ components: disableComponents(ctx.message.components as ComponentActionRow[]) });
      return ctx.send({
        content: 'That voice test was not found or may have already ended.',
        ephemeral: true
      });
    }

    const hasPermission = checkRecordingPermission(ctx.member!, await prisma.guild.findFirst({ where: { id: ctx.guildID } }));
    if (!hasPermission)
      return ctx.send({
        content: 'You need the `Manage Server` permission or have an access role to manage voice tests.',
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
    const [, action, ...args] = ctx.customID.split(':');
    if (ctx.message.interaction!.user.id !== ctx.user.id)
      return ctx.send({
        content: 'Only the person who executed this command can use this button.',
        ephemeral: true
      });

    switch (action) {
      case 'bless': {
        const [guildID] = args;
        try {
          await ctx.editParent({ components: [] });
          await ctx.send(await blessServer(ctx.user.id, guildID, this.emojis));
        } catch (e) {
          this.logger.error(`Error blessing server ${guildID}:`, e);
          await ctx.send({
            content: 'An error occurred while blessing the server.',
            ephemeral: true
          });
        }
        return;
      }
      case 'unbless': {
        const [guildID] = args;
        try {
          await ctx.editParent({ components: [] });
          await ctx.send(await unblessServer(ctx.user.id, guildID));
        } catch (e) {
          this.logger.error(`Error unblessing server ${guildID}:`, e);
          await ctx.send({
            content: 'An error occurred while removing the blessing from the server.',
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
            content: 'An error occurred while using this interaction.',
            ephemeral: true
          });
        }
        return;
      }
    }
  }
}
