import { CommandContext, DexareClient, DexareCommand } from 'dexare';
import { escapeRegex } from 'dexare/lib/util';
import { CraigBot } from '../bot';
import ShardingModule from '../modules/sharding';
import util from 'util';
import Eris from 'eris';
import { makeError } from '../util';

const nl = '!!NL!!';
const nlPattern = new RegExp(nl, 'g');

export default class ManagerEvalCommand extends DexareCommand {
  private _sensitivePattern?: RegExp;

  constructor(client: DexareClient<any>) {
    super(client, {
      name: 'managereval',
      description: 'Evaluates code on the shard manager.',
      aliases: ['meval'],
      category: 'Developer',
      userPermissions: ['dexare.elevated'],
      metadata: {
        usage: '<code>',
        examples: ['meval 1+1']
      }
    });

    Object.defineProperty(this, '_sensitivePattern', {
      value: null,
      configurable: true
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    const client = this.client as unknown as CraigBot;
    const sharding = client.modules.get('sharding') as ShardingModule;
    let script = ctx.event
      .get('commands/strippedContent')
      .slice(ctx.event.get('commands/commandName').length + 1)
      .trim();
    if (script.startsWith('```') && script.endsWith('```')) script = script.replace(/(^.*?\s)|(\n.*$)/g, '');

    if (!sharding.on) return 'Sharding is not enabled.';
    if (!script) return 'You need to eval something.';

    const hrStart = process.hrtime();
    const res = await sharding.sendAndRecieve<{ result: any; error: any }>('managerEval', { script });
    const hrDiff = process.hrtime(hrStart);
    if (res.d.error) return `Error while evaluating: \`${makeError(res.d.error)}\``;
    return void (await ctx.reply(...this.makeResultMessages(res.d.result, hrDiff, script)));
  }

  makeResultMessages(result: any, hrDiff: [number, number], input?: string): [string, Eris.FileContent | undefined] {
    const inspected = util
      .inspect(result, { depth: 0 })
      .replace(nlPattern, '\n')
      .replace(this.sensitivePattern, '--snip--');
    if (input) {
      if (input.length > 1900)
        return [
          '',
          {
            name: 'eval.js',
            file: Buffer.from(
              `// Executed in ${hrDiff[0] > 0 ? `${hrDiff[0]}s ` : ''}${hrDiff[1] / 1000000}ms.\n\n${inspected}`
            )
          }
        ];
      return [
        `*Executed in ${hrDiff[0] > 0 ? `${hrDiff[0]}s ` : ''}${hrDiff[1] / 1000000}ms.*\n\`\`\`js\n` +
          inspected.slice(0, 1900) +
          `\`\`\``,
        undefined
      ];
    }
    return ['No input.', undefined];
  }

  get sensitivePattern() {
    if (!this._sensitivePattern) {
      // @ts-ignore
      const token = this.client.bot._token;
      let pattern = '';
      if (token) pattern += escapeRegex(token);
      Object.defineProperty(this, '_sensitivePattern', {
        value: new RegExp(pattern, 'gi'),
        configurable: false
      });
    }
    return this._sensitivePattern!;
  }
}
