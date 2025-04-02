import { exponentialBuckets, Gauge, Histogram } from '@craig/metrics';

export const requestHistogram = new Histogram({
  name: 'craig_ennuizel_streamer_requests',
  help: 'Request histogram',
  buckets: [0.1, 0.25, 1, 2.5, 5, 20],
  labelNames: ['route', 'status'] as const
});

export const wsHistogram = new Histogram({
  name: 'craig_ennuizel_streamer_websocket_lifetime',
  help: 'Websocket lifetime histogram',
  buckets: exponentialBuckets(1, 4, 5)
});

export const openStreams = new Gauge({
  name: 'craig_ennuizel_streamer_open_streams',
  help: 'Gauge for currently open streams'
});
