module.exports = {
  apps: [
    {
      name: 'Craig BotCTL',
      script: 'dist/index.mjs',
      wait_ready: true,
      log_date_format: 'YYYY-MM-DDTHH:mm:ss.SSSZ',
      kill_timeout: 3000
    }
  ]
};
