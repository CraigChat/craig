module.exports = {
  apps: [
    {
      name: 'Kitchen',
      script: 'dist/index.js',
      wait_ready: true,
      kill_timeout: 10000
    }
  ]
};
