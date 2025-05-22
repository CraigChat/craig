import { stripIndents } from 'common-tags';
import { CommandContext, CommandOptionType, SlashCreator } from 'slash-create';

import { processCooldown } from '../redis';
import GeneralCommand from '../slashCommand';

export default class ServerSettings extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'server-settings',
      description: 'Gerir configurações do servidor.',
      deferEphemeral: true,
      dmPermission: false,
      options: [
        {
          type: CommandOptionType.SUB_COMMAND,
          name: 'view',
          description: 'Ver configurações.'
        },
        {
          type: CommandOptionType.SUB_COMMAND_GROUP,
          name: 'access-role',
          description: 'Gerir cargos de acesso.',
          options: [
            {
              type: CommandOptionType.SUB_COMMAND,
              name: 'add',
              description: 'Adicionar cargo de acesso.',
              options: [
                {
                  type: CommandOptionType.ROLE,
                  name: 'role',
                  description: 'O cargo a ser adicionado.',
                  required: true
                }
              ]
            },
            {
              type: CommandOptionType.SUB_COMMAND,
              name: 'remove',
              description: 'Remover um cargo de acesso.',
              options: [
                {
                  type: CommandOptionType.ROLE,
                  name: 'role',
                  description: 'O cargo a ser removido.',
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
    if (!ctx.guildID) return 'Esse comando deve ser usado em um servidor.';
    const guild = this.client.bot.guilds.get(ctx.guildID)!;

    const userCooldown = await processCooldown(`command:${ctx.user.id}`, 5, 3);
    if (userCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the server-settings command, but was ratelimited.`
      );
      return {
        content: 'Espere alguns segundos antes de usar esse comando.',
        ephemeral: true
      };
    }

    const guildData = await this.prisma.guild.findFirst({ where: { id: ctx.guildID } });
    if (!ctx.member!.permissions.has('MANAGE_GUILD'))
      return {
        content: 'Você não tem permissão para gerenciar esse servidor.',
        ephemeral: true
      };

    switch (ctx.subcommands[0]) {
      case 'view': {
        return {
          embeds: [
            {
              title: 'Server Settings',
              description: stripIndents`
                **Cargos de acesso:** ${guildData && guildData.accessRoles.length ? guildData.accessRoles.map((r) => `<@&${r}>`).join(', ') : '*None*'}
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
                content: 'Este já é um cargo de acesso.',
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
              content: `Adicionado <@&${roleID}> como cargo de acesso.`,
              ephemeral: true
            };
          }
          case 'remove': {
            const roleID = ctx.options['access-role'].remove.role;
            if (!guildData || !guildData.accessRoles.includes(roleID))
              return {
                content: 'Este já não é um cargo de acesso.',
                ephemeral: true
              };
            await this.prisma.guild.update({
              where: { id: ctx.guildID },
              data: { accessRoles: guildData.accessRoles.filter((r) => r !== roleID).filter((r) => guild.roles.has(r)) }
            });
            return {
              content: `Removido <@&${roleID}> dos cargos de acesso.`,
              ephemeral: true
            };
          }
        }
      }
    }

    return {
      content: 'Desconhecido.',
      ephemeral: true
    };
  }
}
