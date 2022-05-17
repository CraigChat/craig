import { stripIndents } from 'common-tags';
import { CommandContext, CommandOptionType, SlashCreator } from 'slash-create';

import { processCooldown } from '../redis';
import GeneralCommand from '../slashCommand';

export default class ServerSettings extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'server-settings',
      description: 'Manage server settings.',
      deferEphemeral: true,
      dmPermission: false,
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

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    if (!ctx.guildID) return 'This command can only be used in a guild.';
    const guild = this.client.bot.guilds.get(ctx.guildID)!;

    const userCooldown = await processCooldown(`command:${ctx.user.id}`, 5, 3);
    if (userCooldown !== true)
      return {
        content: 'You are running commands too often! Try again in a few seconds.',
        ephemeral: true
      };

    const guildData = await this.prisma.guild.findFirst({ where: { id: ctx.guildID } });
    if (!ctx.member!.permissions.has('MANAGE_GUILD'))
      return {
        content: 'You need the `Manage Server` permission to change server settings.',
        ephemeral: true
      };

    switch (ctx.subcommands[0]) {
      case 'view': {
        return {
          embeds: [
            {
              title: 'Server Settings',
              description: stripIndents`
                **Access Roles:** ${guildData && guildData.accessRoles.length ? guildData.accessRoles.map((r) => `<@&${r}>`).join(', ') : '*None*'}
              `
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
                content: 'This role is already an access role.',
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
              content: `Added role <@&${roleID}> to access roles.`,
              ephemeral: true
            };
          }
          case 'remove': {
            const roleID = ctx.options['access-role'].remove.role;
            if (!guildData || !guildData.accessRoles.includes(roleID))
              return {
                content: 'This role is not an access role.',
                ephemeral: true
              };
            await this.prisma.guild.update({
              where: { id: ctx.guildID },
              data: { accessRoles: guildData.accessRoles.filter((r) => r !== roleID).filter((r) => guild.roles.has(r)) }
            });
            return {
              content: `Removed <@&${roleID}> from access roles.`,
              ephemeral: true
            };
          }
        }
      }
    }

    return {
      content: 'Unknown sub-command.',
      ephemeral: true
    };
  }
}
