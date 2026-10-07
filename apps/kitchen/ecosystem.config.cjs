module.exports = {
  apps: [
    {
      name: 'Kitchen',
      script: 'dist/index.js',
      wait_ready: true,
      log_date_format: 'YYYY-MM-DDTHH:mm:ss.SSSZ',
      kill_timeout: 10000
    }
  ]
};
