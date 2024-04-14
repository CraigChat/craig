import { CommandContext, DexareClient } from 'dexare';
import Eris from 'eris';

import ShardingModule from '../modules/sharding';
import TextCommand, { replyOrSend } from '../util';

type AllowedType = Eris.SelfStatus & 'default' & 'custom';
const ALLOWED_TYPES = ['online', 'idle', 'dnd', 'default', 'custom'] as AllowedType[];

export default class SetStatusCommand extends TextCommand {
  constructor(client: DexareClient<any>) {
    super(client, {
      name: 'setstatus',
      description: 'Set the status of this bot.',
      category: 'Developer',
      userPermissions: ['dexare.elevated'],
      metadata: {
        usage: '<type> <message>',
        examples: ['setstatus idle "Scheduled maintenance"', 'setstatus default']
      }
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    const sharding = this.client.modules.get('sharding') as ShardingModule;
    const type = ctx.args[0] as unknown as AllowedType;
    if (!ALLOWED_TYPES.includes(type))
      return void (await replyOrSend(ctx, `You need to use one of the specified types: ${ALLOWED_TYPES.join(', ')}.`));

    if (type !== 'default' && !ctx.args[1]) return void (await replyOrSend(ctx, 'You need a message for your status!'));

    if (sharding.on) sharding.send('setStatus', { status: ctx.args[0], message: ctx.args[1] });
    else if (type === 'default') this.client.bot.editStatus('online', this.client.config.status);
    else if (type === 'custom')
      // @ts-ignore
      this.client.bot.editStatus({
        type: 4,
        name: 'craig',
        state: ctx.args[1]
      });
    else
      this.client.bot.editStatus(type, {
        type: 0,
        name: ctx.args[1]
      });
    await replyOrSend(ctx, 'Updated the status.');
  }
}
