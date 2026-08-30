import http from 'node:http';

import { collectDefaultMetrics, register } from 'prom-client';

interface Logger {
  info(...args: any[]): void;
  error(...args: any[]): void;
  log(...args: any[]): void;
}

function startMetricsServer(logger?: Logger) {
  collectDefaultMetrics();
  const port = process.env.METRICS_PORT ? parseInt(process.env.METRICS_PORT) : null;
  if (!port) return null;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/metrics') {
      res.writeHead(200, { 'Content-Type': register.contentType });
      res.write(await register.metrics());
    }
    res.end();
  });
  server.on('error', (e) => logger?.error('Metrics server error:', e));
  server.listen(port, () => logger?.info(`Metrics server started on port ${port}`));
  return server;
}

export { startMetricsServer };
export * from 'prom-client';
