// Minimal tasks config for smoke tests — mirrors apps/tasks/config/_default.js
// All credentials are intentionally empty; only Redis/DB connectivity is tested.
const recordingRetentionMs = 3 * 24 * 60 * 60 * 1000;

module.exports = {
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    keyPrefix: 'craig:'
  },
  drive: { clientId: '', clientSecret: '', folderPath: 'Craig' },
  microsoft: { clientId: '', clientSecret: '', redirect: '' },
  dropbox: { clientId: '', clientSecret: '', folderName: 'CraigChat' },
  downloads: {
    expiration: 86400000,
    path: process.env.DOWNLOADS_PATH || '/app/downloads'
  },
  recording: {
    fallbackExpiration: recordingRetentionMs,
    path: '/app/rec',
    skipIds: []
  },
  timezone: 'UTC',
  loggerLevel: 'debug',
  tasks: { ignore: [] }
};
