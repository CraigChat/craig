module.exports = {
  apps: [
    {
      name: 'Craig Tasks',
      script: 'dist/index.mjs',
      wait_ready: true,
      kill_timeout: 10000
    }
  ]
};
