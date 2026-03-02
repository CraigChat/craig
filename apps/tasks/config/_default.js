module.exports = {
  // Redis defaults to the compose service name when running in Docker.
  redis: {
    host: process.env.REDIS_HOST || (process.env.container === 'docker' ? 'redis' : 'localhost'),
    port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
    keyPrefix: 'craig:'
  },
  // redis: {
  //   host: 'localhost',
  //   port: 6379,
  //   keyPrefix: 'craig:'
  // },

  // For drive upload in Google Drive
  drive: {
    clientId: '',
    clientSecret: ''
  },

  // For drive upload in Microsoft OneDrive
  microsoft: {
    clientId: '',
    clientSecret: '',
    redirect: ''
  },

  // For drive upload in Dropbox
  dropbox: {
    clientId: '',
    clientSecret: '',
    folderName: 'CraigChat'
  },

  // for refresh patrons job
  patreon: {
    campaignId: 0,
    accessToken: '',
    tiers: {},
    skipUsers: []
  },

  downloads: {
    expiration: 24 * 60 * 60 * 1000,
    path: '../download/downloads'
  },

  recording: {
    fallbackExpiration: 24 * 60 * 60 * 1000,
    path: '../../rec',
    skipIds: []
  },

  timezone: 'America/New_York',
  loggerLevel: 'debug',
  tasks: {
    ignore: []
  },

  transcript: {
    enabled: process.env.TRANSCRIPT_ENABLED ? process.env.TRANSCRIPT_ENABLED === 'true' : true,
    queueKey: 'transcript:queue',
    lockTtlS: 14400,
    popTimeoutS: 5,
    model: process.env.OPENAI_TRANSCRIPTION_MODEL || 'whisper-1',
    maxDurationSec: process.env.TRANSCRIPT_MAX_DURATION_SEC ? Number(process.env.TRANSCRIPT_MAX_DURATION_SEC) : 7200,
    maxFileMb: process.env.TRANSCRIPT_MAX_FILE_MB ? Number(process.env.TRANSCRIPT_MAX_FILE_MB) : 24,
    previewChars: process.env.TRANSCRIPT_PREVIEW_CHARS ? Number(process.env.TRANSCRIPT_PREVIEW_CHARS) : 1200,
    workerConcurrency: process.env.TRANSCRIPT_WORKER_CONCURRENCY ? Number(process.env.TRANSCRIPT_WORKER_CONCURRENCY) : 1
  }
};
