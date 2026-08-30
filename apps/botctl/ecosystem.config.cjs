module.exports = {
  apps: [
    {
      name: 'Craig BotCTL',
      script: 'dist/index.mjs',
      wait_ready: true,
      kill_timeout: 3000
    }
  ]
};
