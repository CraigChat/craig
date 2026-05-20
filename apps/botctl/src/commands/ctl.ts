import { inspect } from 'node:util';

import {
  AutocompleteContext,
  CommandContext,
  CommandOptionType,
  ComponentType,
  MessageFlags,
  SlashCommand,
  SlashCreator,
  TextInputStyle
} from 'slash-create';

import type { BotCTLBot } from '../bot.js';
import { ControlClient, inspectEvalResult, type ShardSelector } from '../controlClient.js';
import { codeBlock, formatAction, formatInfo, formatShardInfo, redact, truncateForDiscord } from '../format.js';

const statusChoices = ['online', 'idle', 'dnd', 'default', 'custom'].map((value) => ({ name: value, value }));
const targetChoices = ['manager', 'shard'].map((value) => ({ name: value, value }));

export default class CtlCommand extends SlashCommand<BotCTLBot> {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'ctl',
      description: 'Control Craig bot shard managers.',
      dmPermission: true,
      deferEphemeral: true,
      options: [
        {
          type: CommandOptionType.SUB_COMMAND,
          name: 'info',
          description: 'Show bot summary information.',
          options: [botOption()]
        },
        {
          type: CommandOptionType.SUB_COMMAND,
          name: 'shards',
          description: 'Show shard information.',
          options: [botOption()]
        },
        {
          type: CommandOptionType.SUB_COMMAND,
          name: 'eval',
          description: 'Evaluate code on the manager or a shard.',
          options: [
            botOption(),
            {
              type: CommandOptionType.STRING,
              name: 'target',
              description: 'Where to evaluate code.',
              required: true,
              choices: targetChoices
            },
            {
              type: CommandOptionType.INTEGER,
              name: 'shard',
              description: 'Shard ID when target is shard.',
              min_value: 0
            }
          ]
        },
        {
          type: CommandOptionType.SUB_COMMAND,
          name: 'rwa',
          description: 'Set respawn-when-available on shards.',
          options: [
            botOption(),
            {
              type: CommandOptionType.BOOLEAN,
              name: 'value',
              description: 'Whether RWA should be enabled.',
              required: true
            },
            shardsOption()
          ]
        },
        {
          type: CommandOptionType.SUB_COMMAND,
          name: 'maintenance',
          description: 'Set or clear maintenance mode.',
          options: [
            botOption(),
            {
              type: CommandOptionType.STRING,
              name: 'message',
              description: 'Maintenance message. Leave empty to clear.'
            }
          ]
        },
        {
          type: CommandOptionType.SUB_COMMAND,
          name: 'restart',
          description: 'Restart shards.',
          options: [botOption(), shardsOption()]
        },
        {
          type: CommandOptionType.SUB_COMMAND,
          name: 'status',
          description: 'Set the bot status.',
          options: [
            botOption(),
            {
              type: CommandOptionType.STRING,
              name: 'type',
              description: 'Status type.',
              required: true,
              choices: statusChoices
            },
            {
              type: CommandOptionType.STRING,
              name: 'message',
              description: 'Status message.'
            }
          ]
        }
      ]
    });
  }

  get botctl() {
    return this.creator.client as BotCTLBot;
  }

  async run(ctx: CommandContext) {
    if (!this.isAuthorized(ctx.user.id))
      return {
        content: 'You are not allowed to use bot control commands.',
        ephemeral: true
      };

    const subcommand = ctx.subcommands[0];
    if (subcommand === 'eval') return this.openEvalModal(ctx);

    try {
      const options = ctx.options[subcommand] ?? {};
      const endpoint = await this.botctl.store.get(String(options.bot));
      const client = new ControlClient(endpoint);

      switch (subcommand) {
        case 'info':
          return ephemeral(formatInfo(endpoint.name, await client.getInfo()));
        case 'shards':
          return shardInfoResponse(formatShardInfo(await client.getShards()));
        case 'rwa':
          return ephemeral(formatAction(await client.setRWA(parseShardSelector(options.shards || 'all'), Boolean(options.value)), 'Updated RWA.'));
        case 'maintenance': {
          const result = await client.setMaintenance(options.message || undefined);
          return ephemeral(result.enabled ? 'Maintenance mode has been set.' : 'Maintenance mode has been removed.');
        }
        case 'restart':
          return ephemeral(formatAction(await client.restart(parseShardSelector(options.shards || 'all')), 'Restarted shards.'));
        case 'status':
          await client.setStatus(String(options.type), options.message ? String(options.message) : undefined);
          return ephemeral('Updated status.');
        default:
          return ephemeral('Unknown control command.');
      }
    } catch (error) {
      return ephemeral(formatError(error));
    }
  }

  async autocomplete(ctx: AutocompleteContext) {
    if (ctx.focused !== 'bot' || !this.isAuthorized(ctx.user.id)) return ctx.sendResults([]);

    const subcommand = ctx.subcommands[0];
    const value = String(ctx.options[subcommand]?.bot ?? '').toLowerCase();
    const endpoints = await this.botctl.store.list();
    const choices = endpoints
      .filter((endpoint) => !value || endpoint.name.toLowerCase().includes(value))
      .slice(0, 25)
      .map((endpoint) => ({
        name: endpoint.name,
        value: endpoint.name
      }));

    return ctx.sendResults(choices);
  }

  private async openEvalModal(ctx: CommandContext) {
    const options = ctx.options.eval ?? {};
    const target = String(options.target);
    if (target !== 'manager' && target !== 'shard') return ephemeral('Target must be manager or shard.');
    const shard = target === 'shard' ? options.shard : undefined;
    if (target === 'shard' && !Number.isInteger(shard)) return ephemeral('A shard ID is required when target is shard.');

    await ctx.sendModal(
      {
        title: `Eval ${String(options.bot)} ${target}${target === 'shard' ? ` ${shard}` : ''}`,
        components: [
          {
            type: ComponentType.ACTION_ROW,
            components: [
              {
                type: ComponentType.TEXT_INPUT,
                label: 'Code',
                style: TextInputStyle.PARAGRAPH,
                custom_id: 'code',
                required: true,
                max_length: 4000
              }
            ]
          }
        ]
      },
      async (modalCtx) => {
        if (!this.isAuthorized(modalCtx.user.id))
          return modalCtx.send({
            content: 'You are not allowed to use bot control commands.',
            ephemeral: true
          });

        try {
          const endpoint = await this.botctl.store.get(String(options.bot));
          const result = await new ControlClient(endpoint).eval(target, String(modalCtx.values.code || ''), shard);
          if (result.error) throw new Error(result.error);
          const inspected = redact(inspectEvalResult(result.result), [endpoint.token, this.botctl.config.discordToken]);
          return modalCtx.send({
            content: codeBlock(truncateForDiscord(inspected), 'js'),
            ephemeral: true
          });
        } catch (error) {
          return modalCtx.send({
            content: formatError(error),
            ephemeral: true
          });
        }
      }
    );
  }

  private isAuthorized(userID: string) {
    return this.botctl.config.adminUsers.includes(userID);
  }
}

function botOption() {
  return {
    type: CommandOptionType.STRING,
    name: 'bot',
    description: 'Stored bot endpoint name.',
    required: true,
    autocomplete: true
  };
}

function shardsOption() {
  return {
    type: CommandOptionType.STRING,
    name: 'shards',
    description: 'Use "all" or comma-separated shard IDs.',
    required: true
  };
}

function parseShardSelector(value: string): ShardSelector {
  if (value === 'all') return 'all';
  const ids = String(value)
    .split(',')
    .map((part) => parseInt(part.trim(), 10));
  if (!ids.length || ids.some((id) => !Number.isInteger(id) || id < 0)) throw new Error('Shards must be "all" or comma-separated shard IDs.');
  return [...new Set(ids)];
}

function ephemeral(content: string) {
  return {
    content,
    flags: MessageFlags.EPHEMERAL
  };
}

function shardInfoResponse(content: string) {
  const lines = content.split('\n');
  const block = codeBlock(content);
  if (lines.length < 20 && block.length <= 2000) return ephemeral(block);

  return {
    flags: MessageFlags.EPHEMERAL,
    files: [
      {
        name: 'shards.txt',
        file: Buffer.from(content)
      }
    ]
  };
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  return inspect(error, { depth: 0 });
}
