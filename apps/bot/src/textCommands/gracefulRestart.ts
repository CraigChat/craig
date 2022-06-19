import { CommandContext, DexareClient } from 'dexare';

import ShardingModule from '../modules/sharding';
import TextCommand, { replyOrSend } from '../util';

export default class GracefulRestartCommand extends TextCommand {
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
    const sharding = this.client.modules.get('sharding') as ShardingModule;

    if (!sharding.on) return 'Sharding is not enabled.';
    await replyOrSend(ctx, 'Restarting all shards.');
    sharding.send('gracefulRestart');
    return;
  }
}
