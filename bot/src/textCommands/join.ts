import { CommandContext, DexareClient, DexareCommand } from 'dexare';

export default class JoinCommand extends DexareCommand {
  constructor(client: DexareClient<any>) {
    super(client, {
      name: 'join'
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    return 'You should use slash commands...';
  }
}
