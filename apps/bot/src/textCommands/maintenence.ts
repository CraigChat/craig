import { CommandContext, DexareClient } from 'dexare';

import RecorderModule from '../modules/recorder';
import ShardingModule from '../modules/sharding';
import { removeMaintenence, setMaintenence } from '../redis';
import TextCommand, { replyOrSend } from '../util';

export default class MaintenenceCommand extends TextCommand {
  constructor(client: DexareClient<any>) {
    super(client, {
      name: 'maintenence',
      description: 'Set/remove maintenence mode.',
      aliases: ['mt'],
      category: 'Developer',
      userPermissions: ['dexare.elevated'],
      metadata: {
        usage: '[message]',
        examples: ['maintenence', 'maintenence Maintenence mode is currently active.']
      }
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    const sharding = this.client.modules.get('sharding') as ShardingModule;
    const recorder = this.client.modules.get('recorder') as RecorderModule<any>;
    const message = ctx.event
      .get('commands/strippedContent')
      .slice(ctx.event.get('commands/commandName').length + 1)
      .trim();

    if (!message) {
      await removeMaintenence(this.client.bot.user.id);
      await replyOrSend(ctx, 'Maintenence mode has been removed.');
      return;
    }

    await setMaintenence(this.client.bot.user.id, { message });
    if (sharding.on) sharding.send('checkMaintenence');
    else await recorder.checkForMaintenence();
    await replyOrSend(ctx, 'Maintenence mode has been set.');
  }
}
