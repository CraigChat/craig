import { CommandContext, DexareClient, DexareCommand } from 'dexare';

import { prisma } from '../prisma';

export default class BanCommand extends DexareCommand {
  constructor(client: DexareClient<any>) {
    super(client, {
      name: 'ban',
      description: 'Ban someone.',
      category: 'Developer',
      userPermissions: ['dexare.elevated'],
      metadata: {
        usage: '<id|@mention> [reason] [name]',
        examples: ['ban 1234 "example reason" "User"']
      }
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    if (!ctx.args[0]) return void (await ctx.reply('You need to specify a user to ban.'));

    const userId = ctx.args[0].match(/^\d+$/) ? ctx.args[0] : ctx.args[0].match(/^<@!?(\d+)>$/)?.[1];
    if (!userId) return void (await ctx.reply('You need to specify a user to ban.'));

    await prisma.ban.upsert({
      where: { id: userId },
      create: {
        id: userId,
        type: 0,
        reason: ctx.args[1],
        name: ctx.args[2]
      },
      update: {
        reason: ctx.args[1],
        name: ctx.args[2]
      }
    });

    await ctx.reply(`Successfully banned ${ctx.args[0]}.`);
  }
}
