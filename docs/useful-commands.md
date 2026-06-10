# Useful Commands

Run these from the Craig AI repo root:

```bash
cd /root/projects/docker/craig-whisperr/craig
```

> All `docker compose` commands use `.env` for configuration. Copy `.env.example` to `.env` and fill in your values before running.

## Docker

### Dev (HMR / hot reload)

Build dev images and start the full stack:

```bash
docker compose -f docker-compose.dev.yml up --build --remove-orphans
```

TypeScript apps (bot, tasks, download API) restart instantly via `tsx watch` when any `.ts` file in their `src/` is saved. The Next.js dashboard uses its built-in HMR. The rollup page bundle rebuilds on change. Python tasmas restarts via `inotifywait` on any `.py` file change.

Rebuild and recreate a single service:

```bash
docker compose -f docker-compose.dev.yml up -d --build bot
docker compose -f docker-compose.dev.yml up -d --build dashboard
docker compose -f docker-compose.dev.yml up -d --build download
docker compose -f docker-compose.dev.yml up -d --build tasks
docker compose -f docker-compose.dev.yml up -d --build tasmas
```

### Production (pull from GHCR)

See [SELFHOST.DOCKER.md](../SELFHOST.DOCKER.md).

Show running containers:

```bash
docker ps
```

## Logs

Stream logs per service (dev):

```bash
docker compose -f docker-compose.dev.yml logs -f bot
docker compose -f docker-compose.dev.yml logs -f dashboard
docker compose -f docker-compose.dev.yml logs -f download
docker compose -f docker-compose.dev.yml logs -f tasks
docker compose -f docker-compose.dev.yml logs -f tasmas
```

Stream logs per service (production):

```bash
docker compose -f docker-compose.production.yml logs -f bot
docker compose -f docker-compose.production.yml logs -f dashboard
docker compose -f docker-compose.production.yml logs -f download
docker compose -f docker-compose.production.yml logs -f tasks
docker compose -f docker-compose.production.yml logs -f tasmas
```

## Build and Typecheck

Build only the bot (dev container):

```bash
docker exec craig-bot-1 bash -lc 'cd /app && yarn workspace craig-bot build'
```

Build only the tasks service (dev container):

```bash
docker exec craig-tasks-1 bash -lc 'cd /app && yarn workspace craig-tasks build'
```

Typecheck the tasks service (dev container):

```bash
docker exec craig-tasks-1 bash -lc 'cd /app/apps/tasks && yarn tsc --noEmit'
```

## Environment Checks

Verify the public recording URL base (bot container):

```bash
docker compose -f docker-compose.production.yml exec bot printenv API_HOMEPAGE
```

## Database

Open a psql shell:

```bash
docker exec -it craig-db-1 psql -U craig -d craig
```

Run Prisma migrations manually (bot container):

```bash
docker compose -f docker-compose.production.yml exec bot npx prisma migrate deploy --schema=/app/prisma/schema.prisma
```

## TASMAS

Process one recording manually (skips the watcher):

```bash
docker compose -f docker-compose.dev.yml run --rm tasmas \
  python3 /app/tasmas/process_flac_zip.py "$CRAIG_RECORDINGS_DIR/RECORDING_ID.flac.zip"
```

Re-trigger AI summarization for an already-transcribed recording:

```bash
./tasmas/test/trigger-summary.sh RECORDING_ID
```

Check recording state (processing / completed / failed):

```bash
cat "$CRAIG_RECORDINGS_DIR/tasmas/recordings.lock.json" | python3 -m json.tool
```
