import { CommandContext, DexareClient, DexareCommand } from 'dexare';

import { prisma } from '../prisma';

export default class UnbanCommand extends DexareCommand {
  constructor(client: DexareClient<any>) {
    super(client, {
      name: 'unban',
      description: 'Unban someone.',
      category: 'Developer',
      userPermissions: ['dexare.elevated'],
      metadata: {
        usage: '<id|@mention>',
        examples: ['unban 1234']
      }
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    if (!ctx.args[0]) return void (await ctx.reply('You need to specify a user to unban.'));

    const userId = ctx.args[0].match(/^\d+$/) ? ctx.args[0] : ctx.args[0].match(/^<@!?(\d+)>$/)?.[1];
    if (!userId) return void (await ctx.reply('You need to specify a user to unban.'));

    await prisma.ban.delete({
      where: { id: userId }
    });

    await ctx.reply(`Successfully unbanned ${ctx.args[0]}.`);
  }
}
