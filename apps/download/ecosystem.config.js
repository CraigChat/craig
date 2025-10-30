module.exports = {
  apps: [
    {
      name: 'craig.horse',
      script: 'dist/index.js',
      instances: '8',
      exec_mode: 'cluster',
      wait_ready: true,
      listen_timeout: 10000,
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
