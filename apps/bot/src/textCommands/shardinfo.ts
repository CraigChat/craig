import { CommandContext, DexareClient, DexareCommand } from 'dexare';

import { CraigBot } from '../bot';
import ShardingModule from '../modules/sharding';

export default class ShardInfoCommand extends DexareCommand {
  constructor(client: DexareClient<any>) {
    super(client, {
      name: 'shardinfo',
      description: 'Shows information about the shards.',
      category: 'Developer',
      userPermissions: ['dexare.elevated']
    });

    this.filePath = __filename;
  }

  format(seconds: number) {
    function pad(s: number) {
      return (s < 10 ? '0' : '') + s;
    }
    const hours = Math.floor(seconds / (60 * 60));
    const minutes = Math.floor((seconds % (60 * 60)) / 60);
    const s = Math.floor(seconds % 60);

    return pad(hours) + ':' + pad(minutes) + ':' + pad(s);
  }

  async run(ctx: CommandContext) {
    const client = this.client as unknown as CraigBot;
    const sharding = client.modules.get('sharding') as ShardingModule;

    if (!sharding.on) return void (await ctx.reply('Sharding is not enabled.'));
    const {
      d: { res }
    } = await sharding.sendAndRecieve<{
      res: { id: number; status: string; guilds: number; latency: number; uptime: number; recordings: number }[];
    }>('getShardInfo');

    const message =
      `Your Shard ID: ${process.env.SHARD_ID}\n\n` +
      res
        .map(
          (shard) =>
            `${shard.id === parseInt(process.env.SHARD_ID!) ? '>' : ' '} [${shard.id.toString().padStart(3, ' ')}]: ${shard.status.padStart(
              12,
              ' '
            )} | Guilds: ${shard.guilds.toLocaleString().padEnd(6, ' ')} | Latency: ${`${shard.latency}ms`.padEnd(6, ' ')} | Uptime: ${this.format(
              shard.uptime
            )} | Recordings: ${shard.recordings.toLocaleString()}`
        )
        .join('\n');

    await ctx.reply('', {
      name: 'shards.txt',
      file: Buffer.from(message)
    });
  }
}
