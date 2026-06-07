const sharedEnv = {
  NODE_ENV: 'production',
  REDIS_HOST: process.env.REDIS_HOST || 'redis',
  REDIS_PORT: process.env.REDIS_PORT || '6379',
  REDIS_DATABASE: process.env.REDIS_DATABASE || '0',
  REDIS_PREFIX: process.env.REDIS_PREFIX || 'craig:',
  REC_DIRECTORY: process.env.REC_DIRECTORY || '/data/rec',
  DOWNLOADS_DIRECTORY: process.env.DOWNLOADS_DIRECTORY || '/data/downloads',
  OUTPUT_DIRECTORY: process.env.OUTPUT_DIRECTORY || '/data/output'
};

module.exports = {
  apps: [
    {
      name: 'Craig Bot',
      cwd: '/opt/craig/bot',
      script: 'dist/sharding/index.mjs',
      wait_ready: true,
      kill_timeout: 10000,
      env: {
        ...sharedEnv,
        BOT_EMOJI_FOLDER: '/opt/craig/bot/emojis',
        BOT_LOCALE_FOLDER: '/opt/craig/locale',
        BOT_VOICE_TEST_FOLDER: '/opt/craig/bot/audio',
        KITCHEN_URL: process.env.KITCHEN_URL || 'http://127.0.0.1:9000',
        WEBAPP_URL: process.env.WEBAPP_URL || 'ws://127.0.0.1:9001/shard'
      }
    },
    {
      name: 'Kitchen',
      cwd: '/opt/craig/kitchen',
      script: 'dist/index.js',
      wait_ready: true,
      kill_timeout: 10000,
      env: {
        ...sharedEnv,
        HOST: '0.0.0.0',
        PORT: '9000',
        TMP_DIRECTORY: process.env.TMP_DIRECTORY || '/data/tmp'
      }
    },
    {
      name: 'Ferret',
      cwd: '/opt/craig/ferret',
      script: 'build/index.js',
      wait_ready: true,
      kill_timeout: 3000,
      env: {
        ...sharedEnv,
        HOST: '0.0.0.0',
        PORT: '9100',
        KITCHEN_URL: process.env.KITCHEN_URL || 'http://127.0.0.1:9000'
      }
    },
    {
      name: 'Ennuizel Streamer',
      cwd: '/opt/craig/ennuizel-streamer',
      script: 'dist/index.mjs',
      wait_ready: true,
      kill_timeout: 3000,
      env: {
        ...sharedEnv,
        HOST: '0.0.0.0',
        PORT: '9001'
      }
    },
    {
      name: 'Craig Dashboard',
      cwd: '/opt/craig/dashboard',
      script: 'build/index.js',
      wait_ready: true,
      kill_timeout: 3000,
      env: {
        ...sharedEnv,
        HOST: '0.0.0.0',
        PORT: '9200'
      }
    },
    {
      name: 'Craig Tasks',
      cwd: '/opt/craig/tasks',
      script: 'dist/index.mjs',
      wait_ready: true,
      kill_timeout: 10000,
      env: sharedEnv
    }
  ]
};
