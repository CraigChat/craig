import { CommandContext, DexareClient, DexareCommand } from 'dexare';
import { CraigBot } from '../bot';
import ShardingModule from '../modules/sharding';

export default class GracefulRestartCommand extends DexareCommand {
  constructor(client: DexareClient<any>) {
    super(client, {
      name: 'gracefulrestart',
      description: 'Restart all shards.',
      aliases: ['grt', 'restartall'],
      category: 'Developer',
      userPermissions: ['dexare.elevated'],
      metadata: {
        examples: ['gracefulrestart']
      }
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    const client = this.client as unknown as CraigBot;
    const sharding = client.modules.get('sharding') as ShardingModule;

    if (!sharding.on) return 'Sharding is not enabled.';
    await ctx.reply('Restarting all shards.');
    sharding.send('gracefulRestart');
    return;
  }
}
