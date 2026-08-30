module.exports = {
  apps: [
    {
      name: 'Ennuizel Streamer',
      script: 'dist/index.mjs',
      wait_ready: true,
      kill_timeout: 3000
    }
  ]
};
