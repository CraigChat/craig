module.exports = {
  token: process.env.BOTCTL_DISCORD_TOKEN,
  applicationId: process.env.BOTCTL_DISCORD_APPLICATION_ID,
  commandPath: './src/commands',
  env: {
    development: {
      globalToGuild: process.env.BOTCTL_DEVELOPMENT_GUILD_ID
    }
  }
};
