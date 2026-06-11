# Development Setup

Craig can be run in hot-reload mode from source. All services rebuild and restart automatically on code changes.

## Prerequisites

- Docker + Docker Compose
- Git (with submodule support)

## 1. Clone

```sh
git clone --recurse-submodules https://github.com/mhd-hi/craig-ai.git
cd craig-ai
```

## 2. Configure

```sh
cp .env.example .env
```

Fill in `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`, `CLIENT_ID`, and `CLIENT_SECRET` at minimum (see [SELFHOST.DOCKER.md](../SELFHOST.DOCKER.md#1-create-a-discord-application) for how to get these).

Set the OAuth2 redirect URI in your Discord app to `http://localhost:3000/api/login`.

## 3. Start

```sh
docker compose -f docker-compose.dev.yml up --build --remove-orphans
```

Hot-reload behaviour:
- **bot / tasks / download** — `tsx watch` restarts the service instantly on any `.ts` file save
- **dashboard** — Next.js HMR, changes reflect in the browser without a restart
- **tasmas** — `inotifywait` restarts on any `.py` file change

## Rebuilding a single service

```sh
docker compose -f docker-compose.dev.yml up -d --build bot
docker compose -f docker-compose.dev.yml up -d --build dashboard
docker compose -f docker-compose.dev.yml up -d --build download
docker compose -f docker-compose.dev.yml up -d --build tasks
docker compose -f docker-compose.dev.yml up -d --build tasmas
```

## Logs

```sh
docker compose -f docker-compose.dev.yml logs -f bot
docker compose -f docker-compose.dev.yml logs -f dashboard
docker compose -f docker-compose.dev.yml logs -f download
docker compose -f docker-compose.dev.yml logs -f tasks
docker compose -f docker-compose.dev.yml logs -f tasmas
```

## Unlocking all features locally

Replace the `rewardTiers` block in `apps/bot/config/_default.js` to grant every user full access:

```js
rewardTiers: {
  [0]: {
    recordHours: 24,
    downloadExpiryHours: 24 * Number(process.env.RECORDING_RETENTION_DAYS || 3),
    features: ['mix', 'auto', 'drive', 'glowers', 'eccontinuous', 'ecflac', 'mp3'],
    sizeLimitMult: 5
  }
}
```

## Access

| Service   | URL                          |
|-----------|------------------------------|
| Dashboard | http://localhost:3000/login  |
| Download  | http://localhost:5029        |

See [CONTRIBUTING.md](../CONTRIBUTING.md) for linting, testing, and PR guidelines.
