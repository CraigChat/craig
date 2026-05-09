module.exports = {
  apps: [
    {
      name: 'Craig Tasks',
      script: 'dist/index.js',
      instance_var: 'PM2_INSTANCE_ID',
      wait_ready: true,
      kill_timeout: 3000,
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
};
