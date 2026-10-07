module.exports = {
  apps: [
    {
      name: process.env.PM2_PROCESS_NAME || 'Craig Bot',
      script: 'dist/sharding/index.mjs',
      wait_ready: true,
      log_date_format: 'YYYY-MM-DDTHH:mm:ss.SSSZ',
      kill_timeout: 10000
    }
  ]
};
