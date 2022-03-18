import { CommandContext, DexareClient, DexareCommand } from 'dexare';
import { CraigBot } from '../bot';
import RecorderModule from '../modules/recorder';
import ShardingModule from '../modules/sharding';
import { removeMaintenance, setMaintenance } from '../redis';

export default class MaintenanceCommand extends DexareCommand {
  constructor(client: DexareClient<any>) {
    super(client, {
      name: 'maintenance',
      description: 'Set/remove maintenance mode.',
      aliases: ['mt'],
      category: 'Developer',
      userPermissions: ['dexare.elevated'],
      metadata: {
        usage: '[message]',
        examples: ['maintenance', 'maintenance Maintenance mode is currently active.']
      }
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    const client = this.client as unknown as CraigBot;
    const sharding = client.modules.get('sharding') as ShardingModule;
    const recorder = client.modules.get('recorder') as RecorderModule<any>;
    const message = ctx.event
      .get('commands/strippedContent')
      .slice(ctx.event.get('commands/commandName').length + 1)
      .trim();

    if (!message) {
      await removeMaintenance(this.client.bot.user.id);
      await ctx.reply('Maintenance mode has been removed.');
      return;
    }

    await setMaintenance(this.client.bot.user.id, { message });
    if (sharding.on) sharding.send('checkMaintenence');
    else await recorder.checkForMaintenence();
    await ctx.reply('Maintenance mode has been set.');
  }
}
