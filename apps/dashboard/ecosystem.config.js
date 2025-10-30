module.exports = {
  apps: [
    {
      name: 'Craig Dashboard',
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: 'development',
        PORT: '3222'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: '3222'
      }
    }
  ]
};
