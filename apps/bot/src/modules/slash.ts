import { BaseConfig, DexareClient, DexareModule } from 'dexare';
import path from 'node:path';
import { ComponentActionRow, ComponentContext, ComponentType, GatewayServer, SlashCreator, SlashCreatorOptions, TextInputStyle } from 'slash-create';

import type { CraigBotConfig } from '../bot';
import { onCommandRun } from '../influx';
import { prisma } from '../prisma';
import { reportErrorFromCommand } from '../sentry';
import { checkRecordingPermission, cutoffText, disableComponents } from '../util';
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
    this.filePath = __filename;
  }

  load() {
    this.creator
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
      else if (ctx.customID.startsWith('user:')) await this.handleUserInteraction(ctx);
    });
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
    if (!hasPermission)
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
            recording.note(modalCtx.values.note || '');
            recording.pushToActivity(
              `${ctx.user.mention} added a note.${modalCtx.values.note ? ` - ${cutoffText(modalCtx.values.note.replace(/\n/g, ' '), 100)}` : ''}`
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
    }
    await ctx.acknowledge();
  }

  async handleUserInteraction(ctx: ComponentContext) {
    const [, action, ...args] = ctx.customID.split(':');
    if (ctx.message.interaction!.user.id !== ctx.user.id)
      return ctx.send({
        content: 'Only the person who executed this command can use this button.',
        ephemeral: true
      });
  }
}
