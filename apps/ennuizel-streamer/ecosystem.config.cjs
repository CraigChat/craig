module.exports = {
  apps: [
    {
      name: 'Ennuizel Streamer',
      script: 'dist/index.js',
      wait_ready: true,
      kill_timeout: 3000
    }
  ]
};
