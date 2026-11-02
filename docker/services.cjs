// The apps in the Craig image, one per Compose service. `craig-entrypoint.sh <service>` starts one.
// Every app also inherits the container's full environment (docker.env); `env` only pins container
// paths/ports and maps shared settings to each app's own names.
const env = (name, fallback = '') => process.env[name] || fallback;

const sharedEnv = {
  NODE_ENV: 'production',
  REDIS_HOST: env('REDIS_HOST', 'redis'),
  REDIS_PORT: env('REDIS_PORT', '6379'),
  REDIS_DATABASE: env('REDIS_DATABASE', '0'),
  REDIS_PREFIX: env('REDIS_PREFIX', 'craig:'),
  REC_DIRECTORY: env('REC_DIRECTORY', '/data/rec'),
  DOWNLOADS_DIRECTORY: env('DOWNLOADS_DIRECTORY', '/data/downloads'),
  OUTPUT_DIRECTORY: env('OUTPUT_DIRECTORY', '/data/output')
};

const dashboardUrl = env('PUBLIC_BASE_URL', env('DASHBOARD_URL')).replace(/\/+$/, '');
const downloadOrigin = process.env.DOWNLOAD_URL ? new URL(process.env.DOWNLOAD_URL).origin : '';
const kitchenUrl = env('KITCHEN_URL', 'http://kitchen:9000');

/** @type {Record<string, { script: string, healthUrl?: string, env: Record<string, string> }>} */
module.exports = {
  bot: {
    script: 'dist/sharding/index.mjs',
    env: {
      ...sharedEnv,
      BOT_SYNC_COMMANDS: 'true',
      BOT_EMOJI_FOLDER: '/opt/craig/bot/emojis',
      BOT_LOCALE_FOLDER: '/opt/craig/locale',
      BOT_VOICE_TEST_FOLDER: '/opt/craig/bot/audio',
      KITCHEN_URL: kitchenUrl,
      WEBAPP_URL: env('WEBAPP_URL', 'ws://webapp-server:9002/shard')
    }
  },
  kitchen: {
    script: 'dist/index.js',
    healthUrl: 'http://127.0.0.1:9000/health',
    env: {
      ...sharedEnv,
      HOST: '0.0.0.0',
      PORT: '9000',
      TMP_DIRECTORY: env('TMP_DIRECTORY', '/tmp/craig'),
      GOOGLE_CLIENT_ID: env('GOOGLE_CLIENT_ID', env('PUBLIC_GOOGLE_CLIENT_ID')),
      MICROSOFT_CLIENT_ID: env('MICROSOFT_CLIENT_ID', env('PUBLIC_MICROSOFT_CLIENT_ID')),
      MICROSOFT_CLIENT_REDIRECT: env('MICROSOFT_CLIENT_REDIRECT', dashboardUrl && `${dashboardUrl}/api/connections/microsoft/callback`),
      DROPBOX_CLIENT_ID: env('DROPBOX_CLIENT_ID', env('PUBLIC_DROPBOX_CLIENT_ID')),
      BOX_CLIENT_ID: env('BOX_CLIENT_ID', env('PUBLIC_BOX_CLIENT_ID'))
    }
  },
  ferret: {
    script: 'build/index.js',
    healthUrl: 'http://127.0.0.1:9100/api/health',
    env: {
      ...sharedEnv,
      HOST: '0.0.0.0',
      PORT: '9100',
      ORIGIN: env('FERRET_ORIGIN', downloadOrigin),
      KITCHEN_URL: kitchenUrl
    }
  },
  'ennuizel-streamer': {
    script: 'dist/index.mjs',
    healthUrl: 'http://127.0.0.1:9001/health',
    env: {
      ...sharedEnv,
      HOST: '0.0.0.0',
      PORT: '9001'
    }
  },
  'webapp-server': {
    script: 'dist/index.mjs',
    healthUrl: 'http://127.0.0.1:9002/health',
    env: {
      ...sharedEnv,
      HOST: '0.0.0.0',
      PORT: '9002',
      SHARD_AUTH: env('WEBAPP_TOKEN')
    }
  },
  dashboard: {
    script: 'build/index.js',
    healthUrl: 'http://127.0.0.1:9200/api/health',
    env: {
      ...sharedEnv,
      HOST: '0.0.0.0',
      PORT: '9200'
    }
  },
  tasks: {
    script: 'dist/index.mjs',
    env: {
      ...sharedEnv,
      TASKS_IGNORE: [env('TASKS_IGNORE'), 'refreshPatrons'].filter(Boolean).join(',')
    }
  }
};
