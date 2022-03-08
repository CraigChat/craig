import { DexareModule, DexareClient } from 'dexare';
import Eris from 'eris';
import { access, mkdir } from 'fs/promises';
import path from 'path';
import { CraigBotConfig } from '../../bot';
import Recording from './recording';

export default class RecorderModule<T extends DexareClient<CraigBotConfig>> extends DexareModule<T> {
  recordings = new Map<string, Recording>();
  recordingPath: string;

  constructor(client: T) {
    super(client, {
      name: 'recorder',
      description: 'Recording handler'
    });

    this.recordingPath = path.resolve(__dirname, '../../..', this.client.config.craig.recordingFolder);
    this.filePath = __filename;
  }

  async load() {
    this.registerEvent('voiceStateUpdate', this.onVoiceStateUpdate.bind(this));

    try {
      await access(this.recordingPath);
    } catch (e) {
      this.logger.info('Recording folder not found, creating...');
      await mkdir(this.recordingPath);
      return;
    }
  }

  unload() {
    this.unregisterAllEvents();
  }

  find(id: string) {
    for (const recording of this.recordings.values()) {
      if (recording.id === id) return recording;
    }
  }

  onVoiceStateUpdate(_: any, member: Eris.Member, oldState: Eris.OldVoiceState) {
    const recording = this.recordings.get(member.guild.id);
    if (!recording) return;

    recording.onVoiceStateUpdate(member, oldState);
  }
}
