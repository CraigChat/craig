import { getGuildAccessRoles } from '@craig/db';
import { ButtonStyle, CommandContext, CommandOptionType, ComponentType, SlashCreator } from 'slash-create';

import { processCooldown } from '../redis.js';
import GeneralCommand from '../slashCommand.js';
import { checkBan, mainBotCommandOnly } from '../util.js';

export default class ServerSettings extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'server-settings',
      description: 'Manage server settings.',
      deferEphemeral: true,
      dmPermission: false,
      guildIDs: mainBotCommandOnly,
      options: [
        {
          type: CommandOptionType.SUB_COMMAND,
          name: 'view',
          description: 'View server settings.'
        },
        {
          type: CommandOptionType.SUB_COMMAND_GROUP,
          name: 'access-role',
          description: 'Manage access roles.',
          options: [
            {
              type: CommandOptionType.SUB_COMMAND,
              name: 'add',
              description: 'Add an access role.',
              options: [
                {
                  type: CommandOptionType.ROLE,
                  name: 'role',
                  description: 'The role to add.',
                  required: true
                }
              ]
            },
            {
              type: CommandOptionType.SUB_COMMAND,
              name: 'remove',
              description: 'Remove an access role.',
              options: [
                {
                  type: CommandOptionType.ROLE,
                  name: 'role',
                  description: 'The role to remove.',
                  required: true
                }
              ]
            }
          ]
        }
      ]
    });
  }

  async run(ctx: CommandContext) {
    const [t] = this.createT(ctx);
    if (!ctx.guildID) return t('responses.guild_only');
    const guild = this.client.bot.guilds.get(ctx.guildID);

    if (!guild)
      return {
        content: t('responses.guild_unavailable', { server_invite: 'https://discord.gg/craig' }),
        ephemeral: true,
        components: [
          {
            type: ComponentType.ACTION_ROW,
            components: [
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.LINK,
                label: t('common.support_server'),
                url: 'https://discord.gg/craig'
              }
            ]
          }
        ]
      };

    if (await checkBan(ctx.user.id))
      return {
        content: t('responses.banned'),
        ephemeral: true
      };

    const userCooldown = await processCooldown(`command:${ctx.user.id}:${this.client?.bot?.user?.id}`, 5, 3);
    if (userCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the server-settings command, but was ratelimited.`
      );
      return {
        content: t('responses.ratelimited'),
        ephemeral: true
      };
    }

    const accessRoles = await getGuildAccessRoles(ctx.guildID);
    if (!ctx.member!.permissions.has('MANAGE_GUILD'))
      return {
        content: t('server_settings.need_perms'),
        ephemeral: true
      };

    switch (ctx.subcommands[0]) {
      case 'view': {
        return {
          embeds: [
            {
              title: t('server_settings.title'),
              description: t('server_settings.view', {
                roles: accessRoles && accessRoles.length ? accessRoles.map((r) => `<@&${r}>`).join(', ') : t('server_settings.none')
              })
            }
          ],
          ephemeral: true
        };
      }
      case 'access-role': {
        switch (ctx.subcommands[1]) {
          case 'add': {
            const roleID = ctx.options['access-role'].add.role;
            if (accessRoles && accessRoles.includes(roleID))
              return {
                content: t('server_settings.already_access_role'),
                ephemeral: true
              };
            const newRoles = [...(accessRoles ? accessRoles.filter((r) => guild.roles.has(r)) : []), roleID];
            await this.db
              .insertInto('Guild')
              .values({ id: ctx.guildID, accessRoles: newRoles })
              .onConflict((oc) => oc.column('id').doUpdateSet({ accessRoles: newRoles }))
              .execute();
            return {
              content: t('server_settings.added_access_role', { role: `<@&${roleID}>` }),
              ephemeral: true
            };
          }
          case 'remove': {
            const roleID = ctx.options['access-role'].remove.role;
            if (!accessRoles || !accessRoles.includes(roleID))
              return {
                content: t('server_settings.not_access_role'),
                ephemeral: true
              };
            await this.db
              .updateTable('Guild')
              .set({ accessRoles: accessRoles.filter((r) => r !== roleID).filter((r) => guild.roles.has(r)) })
              .where('id', '=', ctx.guildID)
              .execute();
            return {
              content: t('server_settings.removed_access_role', { role: `<@&${roleID}>` }),
              ephemeral: true
            };
          }
        }
        break;
      }
    }

    return {
      content: t('responses.unknown_subcommand'),
      ephemeral: true
    };
  }
}
