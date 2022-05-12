import { stripIndents } from 'common-tags';
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
    const message = await ctx.reply(`Restarting shards ${shards.join(', ')}...`);

    const errors: [number, string][] = [];
    for (const shard of shards) {
      const result = await sharding.sendAndRecieve<{ error?: string }>('restartShard', { id: shard }).catch((e) => ({ error: e.toString() }));
      if ('error' in result) errors.push([shard, result.error]);
    }

    await message.edit(stripIndents`
      Restarted shards ${shards.filter((s) => !errors.find((e) => e[0] === s)).join(', ')}.

      ${errors.length ? '**Shards failed to restart:**\n' + errors.map((e) => `- Shard ${e[0]}: ${e[1]}`).join('\n') : ''}
    `);
  }
}
