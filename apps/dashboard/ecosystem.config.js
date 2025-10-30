module.exports = {
  apps: [
    {
      name: 'Craig Dashboard',
      script: 'npm',
      args: 'start',
      out_file: '/dev/stdout',
      error_file: '/dev/stderr',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
};
