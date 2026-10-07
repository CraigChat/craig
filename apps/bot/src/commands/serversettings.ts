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

    const guildData = await this.prisma.guild.findUnique({ where: { id: ctx.guildID } });
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
                roles: guildData && guildData.accessRoles.length ? guildData.accessRoles.map((r) => `<@&${r}>`).join(', ') : t('server_settings.none')
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
            if (guildData && guildData.accessRoles.includes(roleID))
              return {
                content: t('server_settings.already_access_role'),
                ephemeral: true
              };
            await this.prisma.guild.upsert({
              where: { id: ctx.guildID },
              update: {
                accessRoles: [...(guildData ? guildData.accessRoles.filter((r) => guild.roles.has(r)) : []), roleID]
              },
              create: { id: ctx.guildID, accessRoles: [roleID] }
            });
            return {
              content: t('server_settings.added_access_role', { role: `<@&${roleID}>` }),
              ephemeral: true
            };
          }
          case 'remove': {
            const roleID = ctx.options['access-role'].remove.role;
            if (!guildData || !guildData.accessRoles.includes(roleID))
              return {
                content: t('server_settings.not_access_role'),
                ephemeral: true
              };
            await this.prisma.guild.update({
              where: { id: ctx.guildID },
              data: { accessRoles: guildData.accessRoles.filter((r) => r !== roleID).filter((r) => guild.roles.has(r)) }
            });
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
