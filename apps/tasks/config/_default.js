const recordingRetentionDays = Number.parseFloat(process.env.RECORDING_RETENTION_DAYS || '3');
const recordingRetentionMs = Math.max(Number.isFinite(recordingRetentionDays) ? recordingRetentionDays : 3, 1) * 24 * 60 * 60 * 1000;

module.exports = {
  // Redis, leave blank to connect to localhost:6379 with "craig:" as the prefix
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: process.env.REDIS_PORT || 6379,
    keyPrefix: 'craig:'
  },
  // For drive upload in Google Drive
  drive: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    folderPath: process.env.GOOGLE_DRIVE_FOLDER_PATH || 'Craig'
  },

  // For drive upload in Microsoft OneDrive
  microsoft: {
    clientId: process.env.MICROSOFT_CLIENT_ID || '',
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
    redirect: process.env.MICROSOFT_REDIRECT_URI || ''
  },

  // For drive upload in Dropbox
  dropbox: {
    clientId: process.env.DROPBOX_CLIENT_ID || '',
    clientSecret: process.env.DROPBOX_CLIENT_SECRET || '',
    folderName: 'CraigChat'
  },

  downloads: {
    expiration: 24 * 60 * 60 * 1000,
    path: process.env.DOWNLOADS_PATH || '../../downloads'
  },

  recording: {
    fallbackExpiration: recordingRetentionMs,
    path: '../../rec',
    skipIds: []
  },

  timezone: 'America/New_York',
  loggerLevel: 'debug',
  tasks: {
    ignore: []
  }
};
