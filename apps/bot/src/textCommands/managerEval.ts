import { CommandContext, DexareClient } from 'dexare';
import { escapeRegex } from 'dexare/lib/util';
import Eris from 'eris';
import util from 'util';

import ShardingModule from '../modules/sharding';
import TextCommand, { makeError, replyOrSend } from '../util';

const nl = '!!NL!!';
const nlPattern = new RegExp(nl, 'g');

export default class ManagerEvalCommand extends TextCommand {
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
    const sharding = this.client.modules.get('sharding') as ShardingModule;
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
    return void (await replyOrSend(ctx, this.makeResultMessages(res.d.result, hrDiff, script)));
  }

  makeResultMessages(result: any, hrDiff: [number, number], input?: string): Eris.AdvancedMessageContent {
    const inspected = util.inspect(result, { depth: 0 }).replace(nlPattern, '\n').replace(this.sensitivePattern, '--snip--');
    if (input) {
      if (input.length > 1900)
        return {
          attachments: [
            {
              filename: 'eval.js',
              file: Buffer.from(`// Executed in ${hrDiff[0] > 0 ? `${hrDiff[0]}s ` : ''}${hrDiff[1] / 1000000}ms.\n\n${inspected}`)
            }
          ]
        };
      return {
        content: `*Executed in ${hrDiff[0] > 0 ? `${hrDiff[0]}s ` : ''}${hrDiff[1] / 1000000}ms.*\n\`\`\`js\n` + inspected.slice(0, 1900) + `\`\`\``
      };
    }
    return { content: 'No input.' };
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
