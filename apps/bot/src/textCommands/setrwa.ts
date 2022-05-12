import { stripIndents } from 'common-tags';
import { CommandContext, DexareClient, DexareCommand } from 'dexare';

import { CraigBot } from '../bot';
import ShardingModule from '../modules/sharding';

export default class SetRWACommand extends DexareCommand {
  constructor(client: DexareClient<any>) {
    super(client, {
      name: 'setrwa',
      description: 'Sets RWA state of a shard.',
      aliases: ['rwa'],
      category: 'Developer',
      userPermissions: ['dexare.elevated'],
      metadata: {
        usage: '<value> [shardId] ...',
        examples: ['setrwa true this', 'setrwa false 0 1 2', 'setrwa on all']
      }
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    const client = this.client as unknown as CraigBot;
    const sharding = client.modules.get('sharding') as ShardingModule;

    if (!sharding.on) return 'Sharding is not enabled.';

    if (!ctx.args[0]) return 'First argument must be a boolean.';
    const value = ctx.args[0] === 'true' || ctx.args[0] === '1' || ctx.args[0] === 'on';

    if (!ctx.args[1]) return 'Specify a shard ID or use "this" or "all".';

    if (ctx.args[1] === 'this') {
      const message = await ctx.reply(`Setting RWA state to \`${value}\` of this shard...`);
      const result = await sharding
        .sendAndRecieve<{ error?: string }>('setRWA', { id: client.shard?.id ?? parseInt(process.env.SHARD_ID!), value })
        .catch((e) => ({ error: e.toString() }));
      if ('error' in result) await message.edit(`Failed to set RWA state: ${result.error}`);
      else await message.edit(`Set RWA state to \`${value}\` for this shard.`);
      return;
    } else if (ctx.args[1] === 'all') {
      const message = await ctx.reply(`Setting RWA state to \`${value}\` of all shards...`);
      const result = await sharding.sendAndRecieve<{ error?: string }>('setRWA', { id: 'all', value }).catch((e) => ({ error: e.toString() }));
      if ('error' in result) await message.edit(`Failed to set RWA state: ${result.error}`);
      else await message.edit(`Set RWA state to \`${value}\` for all shards.`);
      return;
    }

    const shards = [...new Set(ctx.args.slice(1).map((arg) => parseInt(arg, 10)))];
    const message = await ctx.reply(`Setting RWA state to \`${value}\` for shards ${shards.join(', ')}...`);

    const errors: [number, string][] = [];
    for (const shard of shards) {
      const result = await sharding.sendAndRecieve<{ error?: string }>('setRWA', { id: shard, value }).catch((e) => ({ error: e.toString() }));
      if ('error' in result) errors.push([shard, result.error]);
    }

    await message.edit(stripIndents`
      Set RWA state to \`${value}\` for shards ${shards.filter((s) => !errors.find((e) => e[0] === s)).join(', ')}.

      ${errors.length ? '**Shards failed to be set:**\n' + errors.map((e) => `- Shard ${e[0]}: ${e[1]}`).join('\n') : ''}
    `);
  }
}
