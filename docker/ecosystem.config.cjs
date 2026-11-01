// Every app also inherits the container's full environment (docker.env); the `env` blocks
// below only pin container paths/ports and map shared settings to each app's own names.
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

const env = (name, fallback = '') => process.env[name] || fallback;
const dashboardUrl = env('PUBLIC_BASE_URL', env('DASHBOARD_URL')).replace(/\/+$/, '');
const downloadOrigin = process.env.DOWNLOAD_URL
  ? new URL(process.env.DOWNLOAD_URL).origin
  : process.env.DOWNLOAD_DOMAIN
    ? `${env('DOWNLOAD_PROTOCOL', 'https')}://${process.env.DOWNLOAD_DOMAIN}`
    : '';

module.exports = {
  apps: [
    {
      name: 'Craig Bot',
      cwd: '/opt/craig/bot',
      script: 'dist/sharding/index.mjs',
      wait_ready: true,
      log_date_format: 'YYYY-MM-DDTHH:mm:ss.SSSZ',
      kill_timeout: 60000,
      env: {
        ...sharedEnv,
        BOT_SYNC_COMMANDS: 'true',
        BOT_EMOJI_FOLDER: '/opt/craig/bot/emojis',
        BOT_LOCALE_FOLDER: '/opt/craig/locale',
        BOT_VOICE_TEST_FOLDER: '/opt/craig/bot/audio',
        KITCHEN_URL: env('KITCHEN_URL', 'http://127.0.0.1:9000'),
        WEBAPP_URL: env('WEBAPP_URL', 'ws://127.0.0.1:9002/shard')
      }
    },
    {
      name: 'Kitchen',
      cwd: '/opt/craig/kitchen',
      script: 'dist/index.js',
      wait_ready: true,
      log_date_format: 'YYYY-MM-DDTHH:mm:ss.SSSZ',
      kill_timeout: 30000,
      env: {
        ...sharedEnv,
        HOST: '127.0.0.1',
        PORT: '9000',
        TMP_DIRECTORY: env('TMP_DIRECTORY', '/tmp/craig'),
        GOOGLE_CLIENT_ID: env('GOOGLE_CLIENT_ID', env('PUBLIC_GOOGLE_CLIENT_ID')),
        MICROSOFT_CLIENT_ID: env('MICROSOFT_CLIENT_ID', env('PUBLIC_MICROSOFT_CLIENT_ID')),
        MICROSOFT_CLIENT_REDIRECT: env('MICROSOFT_CLIENT_REDIRECT', dashboardUrl && `${dashboardUrl}/api/connections/microsoft/callback`),
        DROPBOX_CLIENT_ID: env('DROPBOX_CLIENT_ID', env('PUBLIC_DROPBOX_CLIENT_ID')),
        BOX_CLIENT_ID: env('BOX_CLIENT_ID', env('PUBLIC_BOX_CLIENT_ID'))
      }
    },
    {
      name: 'Ferret',
      cwd: '/opt/craig/ferret',
      script: 'build/index.js',
      wait_ready: true,
      log_date_format: 'YYYY-MM-DDTHH:mm:ss.SSSZ',
      kill_timeout: 3000,
      env: {
        ...sharedEnv,
        HOST: '0.0.0.0',
        PORT: '9100',
        ORIGIN: env('FERRET_ORIGIN', downloadOrigin),
        KITCHEN_URL: env('KITCHEN_URL', 'http://127.0.0.1:9000')
      }
    },
    {
      name: 'Ennuizel Streamer',
      cwd: '/opt/craig/ennuizel-streamer',
      script: 'dist/index.mjs',
      wait_ready: true,
      log_date_format: 'YYYY-MM-DDTHH:mm:ss.SSSZ',
      kill_timeout: 10000,
      env: {
        ...sharedEnv,
        HOST: '0.0.0.0',
        PORT: '9001'
      }
    },
    {
      name: 'Webapp Server',
      cwd: '/opt/craig/webapp-server',
      script: 'dist/index.mjs',
      wait_ready: true,
      log_date_format: 'YYYY-MM-DDTHH:mm:ss.SSSZ',
      kill_timeout: 10000,
      env: {
        ...sharedEnv,
        HOST: '0.0.0.0',
        PORT: '9002',
        SHARD_AUTH: env('WEBAPP_TOKEN')
      }
    },
    {
      name: 'Craig Dashboard',
      cwd: '/opt/craig/dashboard',
      script: 'build/index.js',
      wait_ready: true,
      log_date_format: 'YYYY-MM-DDTHH:mm:ss.SSSZ',
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
      log_date_format: 'YYYY-MM-DDTHH:mm:ss.SSSZ',
      kill_timeout: 10000,
      env: {
        ...sharedEnv,
        TASKS_IGNORE: [env('TASKS_IGNORE'), 'refreshPatrons'].filter(Boolean).join(',')
      }
    }
  ]
};
