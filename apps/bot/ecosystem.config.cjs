module.exports = {
  apps: [
    {
      name: 'Craig Bot',
      script: 'dist/sharding/index.mjs',
      wait_ready: true,
      kill_timeout: 10000
    }
  ]
};
