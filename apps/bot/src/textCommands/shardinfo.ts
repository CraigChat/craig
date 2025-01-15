import { CommandContext, DexareClient } from 'dexare';

import ShardingModule from '../modules/sharding';
import TextCommand, { replyOrSend } from '../util';

export default class ShardInfoCommand extends TextCommand {
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

  padValue(value: number | undefined, maxLength: number) {
    return (typeof value === 'number' ? value.toLocaleString() : '-').padEnd(maxLength, ' ');
  }

  async run(ctx: CommandContext) {
    const sharding = this.client.modules.get('sharding') as ShardingModule;

    if (!sharding.on) return void (await replyOrSend(ctx, 'Sharding is not enabled.'));
    const {
      d: { res }
    } = await sharding.sendAndRecieve<{
      res: { id: number; status?: string; guilds?: number; latency?: number; uptime?: number; recordings?: number; respawnWhenAvailable: boolean }[];
    }>('getShardInfo');

    const totalGuilds = res.reduce((acc, cur) => acc + (cur.guilds ?? 0), 0);
    const averageLatency = Math.round(res.reduce((acc, cur) => acc + (cur.latency ?? 0), 0) / res.length);
    const averageUptime = res.reduce((acc, cur) => acc + (cur.uptime ?? 0), 0) / res.length;
    const totalRecordings = res.reduce((acc, cur) => acc + (cur.recordings ?? 0), 0);

    const message =
      `Your Shard ID: ${process.env.SHARD_ID}\n\n` +
      `      --- SUMMARY --- | ${totalGuilds.toLocaleString().padEnd(10, ' ')} | ${`${averageLatency}ms avg`.padEnd(11, ' ')} | ${`${this.format(
        averageUptime
      )} avg`.padEnd(14, ' ')} | ${totalRecordings.toLocaleString().padEnd(12, ' ')} | ${res
        .filter((shard) => shard.respawnWhenAvailable)
        .length.toLocaleString()} shards\n` +
      `       |       Status |   Guilds   |   Latency   |     Uptime     |  Recordings  | RWA\n` +
      res
        .sort((a, b) => a.id - b.id)
        .map(
          (shard) =>
            `${shard.id === parseInt(process.env.SHARD_ID!) ? '>' : ' '} [${shard.id.toString().padStart(3, ' ')}]: ${(
              shard.status ?? 'unknown'
            ).padStart(12, ' ')} | ${this.padValue(shard.guilds, 10)} | ${(typeof shard.latency === 'number'
              ? `${Math.round(shard.latency)}ms`
              : '-'
            ).padEnd(11, ' ')} | ${(typeof shard.uptime === 'number' ? this.format(shard.uptime) : '-').padEnd(14, ' ')} | ${this.padValue(
              shard.recordings,
              12
            )} | ${shard.respawnWhenAvailable ?? '-'}`
        )
        .join('\n');

    await replyOrSend(ctx, {
      attachments: [
        {
          filename: 'shards.txt',
          file: Buffer.from(message)
        }
      ]
    });
  }

  onError(err: Error, ctx: CommandContext) {
    console.log(err);
    return ctx.reply(`An error occurred while running the \`${this.name}\` command.`);
  }
}
