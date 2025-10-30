module.exports = {
  apps: [
    {
      name: 'Craig',
      script: 'dist/sharding/index.js',
      wait_ready: true,
      kill_timeout: 3000,
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
