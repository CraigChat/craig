module.exports = {
  apps: [
    {
      name: 'Ferret',
      script: 'build/index.js',
      wait_ready: true,
      kill_timeout: 3000
    }
  ]
};
