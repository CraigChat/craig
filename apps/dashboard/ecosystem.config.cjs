module.exports = {
  apps: [
    {
      name: 'Craig Dashboard',
      script: 'build/index.js',
      wait_ready: true,
      log_date_format: 'YYYY-MM-DDTHH:mm:ss.SSSZ',
      kill_timeout: 3000
    }
  ]
};
