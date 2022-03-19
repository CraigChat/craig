import { CommandContext, DexareClient, DexareCommand } from 'dexare';
import { CraigBot } from '../bot';
import ShardingModule from '../modules/sharding';

export default class RestartCommand extends DexareCommand {
  constructor(client: DexareClient<any>) {
    super(client, {
      name: 'restart',
      description: 'Restart this shard, or multiple shards.',
      aliases: ['rt'],
      category: 'Developer',
      userPermissions: ['dexare.elevated'],
      metadata: {
        usage: '[shardId] ...',
        examples: ['restart', 'restart 0 1 2']
      }
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    const client = this.client as unknown as CraigBot;
    const sharding = client.modules.get('sharding') as ShardingModule;

    if (!sharding.on) return 'Sharding is not enabled.';

    if (!ctx.args[0]) {
      await ctx.reply('Restarting this shard.');
      sharding.send('restartMe');
      return;
    }

    const shards = [...new Set(ctx.args.map((arg) => parseInt(arg, 10)))];
    await ctx.reply(`Restarting shards ${shards.join(', ')}`);
    for (const shard of shards) sharding.send('restartShard', { id: shard });
  }
}
