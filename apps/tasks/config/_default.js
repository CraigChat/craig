module.exports = {
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
  loggerLevel: 'debug'
};
