module.exports = {
  apps: [
    {
      name: 'Craig Dashboard',
      script: 'build/index.js',
      wait_ready: true,
      kill_timeout: 3000
    }
  ]
};
