import type { CraigBot } from '../bot.js';
import { BotModule } from '../runtime.js';

export default class MetricsModule extends BotModule {
  stats = {
    recordingsStarted: 0,
    autorecordingsStarted: 0,
    commandsRan: 0,
    gatewayEventsReceived: 0,
    commands: {} as Record<string, number>,
    voiceServersConnected: {} as Record<string, number>,
    recordingErrors: {} as Record<string, number>
  };
  private readonly handleRawWS = () => {
    this.stats.gatewayEventsReceived++;
  };

  constructor(client: CraigBot) {
    super(client, {
      name: 'metrics',
      description: 'Metrics collection'
    });
  }

  onCommandRan(commandName: string) {
    if (!this.stats.commands[commandName]) this.stats.commands[commandName] = 1;
    else this.stats.commands[commandName]++;
    this.stats.commandsRan++;
  }

  onRecordingStart(auto = false) {
    this.stats.recordingsStarted++;
    if (auto) this.stats.autorecordingsStarted++;
  }

  onVoiceServerConnect(region: string) {
    if (!this.stats.voiceServersConnected[region]) this.stats.voiceServersConnected[region] = 1;
    else this.stats.voiceServersConnected[region]++;
  }

  onRecordingError(type: string, code = 'none') {
    const key = `${type}:${code}`;
    if (!this.stats.recordingErrors[key]) this.stats.recordingErrors[key] = 1;
    else this.stats.recordingErrors[key]++;
  }

  collect(name: keyof typeof this.stats) {
    if (name === 'commands') {
      const commands = this.stats.commands;
      this.stats.commands = {};
      return commands;
    }
    if (name === 'recordingErrors') {
      const stats = this.stats.recordingErrors;
      this.stats.recordingErrors = {};
      return stats;
    }
    if (name === 'voiceServersConnected') {
      const stats = this.stats.voiceServersConnected;
      this.stats.voiceServersConnected = {};
      return stats;
    }

    const count = this.stats[name];
    this.stats[name] = 0;
    return count;
  }

  load() {
    this.client.bot.on('rawWS', this.handleRawWS);
  }

  unload() {
    this.client.bot.removeListener('rawWS', this.handleRawWS);
  }
}
