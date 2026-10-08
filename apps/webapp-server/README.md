# Craig Webapp Server

This is the server for the [Craig Webapp](https://github.com/CraigChat/webapp). It connects Discord bot shards to web clients.

The server reads the monorepo root `.env` and an optional local `.env`. Set `SHARD_AUTH` (or `WEBAPP_TOKEN`) to the same secret used by the bot. The server listens on port 9002 by default.

From the monorepo root, run `pnpm --filter @craig/webapp-server dev`. Run `pnpm --filter @craig/webapp-server start:test-client` to connect the test client with the ID and key `test`.
