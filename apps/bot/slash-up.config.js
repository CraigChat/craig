module.exports = {
  token: process.env.BOT_TOKEN,
  applicationId: process.env.BOT_APPLICATION_ID,
  commandPath: './src/commands',
  env: {
    development: {
      globalToGuild: process.env.DEVELOPMENT_GUILD_ID
    }
  }
};
