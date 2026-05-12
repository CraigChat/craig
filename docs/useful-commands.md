# Useful Commands

Run these from the Craig AI repo root:

```bash
cd /root/projects/docker/craig-whisperr/craig
```

## Docker

Build the image and start the full stack in the background:

```bash
docker compose build && docker compose up -d
```

Rebuild and recreate only the Craig service:

```bash
docker compose up -d --build craig
```

Rebuild and recreate only the TASMAS sidecar:

```bash
docker compose up -d --build tasmas
```

Show running containers:

```bash
docker ps
```

## Logs

Stream Craig container logs:

```bash
docker logs -f craig-craig-1
```

Stream TASMAS sidecar logs:

```bash
docker logs -f craig-tasmas-1
```

Check PM2 process list inside the Craig container:

```bash
docker exec craig-craig-1 bash -lc 'source /root/.nvm/nvm.sh && nvm use "${NODE_VERSION:-22}" >/dev/null && pm2 list'
```

Monitor PM2 processes live:

```bash
docker exec -it craig-craig-1 bash -lc 'source /root/.nvm/nvm.sh && nvm use "${NODE_VERSION:-22}" >/dev/null && pm2 monit'
```

Restart all PM2 processes:

```bash
docker exec craig-craig-1 bash -lc 'source /root/.nvm/nvm.sh && nvm use "${NODE_VERSION:-22}" >/dev/null && pm2 restart all'
```

## Build and Typecheck

Build every workspace:

```bash
docker exec craig-craig-1 bash -lc 'source /root/.nvm/nvm.sh && nvm use "${NODE_VERSION:-22}" >/dev/null && cd /app && yarn build'
```

Build only the bot:

```bash
docker exec craig-craig-1 bash -lc 'source /root/.nvm/nvm.sh && nvm use "${NODE_VERSION:-22}" >/dev/null && cd /app && yarn workspace craig-bot build'
```

Build only the tasks service:

```bash
docker exec craig-craig-1 bash -lc 'source /root/.nvm/nvm.sh && nvm use "${NODE_VERSION:-22}" >/dev/null && cd /app && yarn workspace craig-tasks build'
```

Typecheck the tasks service:

```bash
docker exec craig-craig-1 bash -lc 'source /root/.nvm/nvm.sh && nvm use "${NODE_VERSION:-22}" >/dev/null && cd /app/apps/tasks && yarn tsc --noEmit'
```

## Environment Checks

Verify the public recording URL base:

```bash
docker exec craig-craig-1 printenv API_HOMEPAGE
```

Verify a recording link shape:

```bash
docker exec craig-craig-1 bash -lc 'source /root/.nvm/nvm.sh && nvm use "${NODE_VERSION:-22}" >/dev/null && node -e "const api = new URL(process.env.API_HOMEPAGE); console.log(api.protocol + \"//\" + api.host + \"/rec/RECORDING_ID?key=ACCESS_KEY\")"'
```

## Database

Open a psql shell:

```bash
docker exec -it craig-db-1 psql -U $POSTGRESQL_USER -d $DATABASE_NAME
```

Run Prisma migrations manually:

```bash
docker exec craig-craig-1 bash -lc 'source /root/.nvm/nvm.sh && nvm use "${NODE_VERSION:-22}" >/dev/null && cd /app && yarn prisma migrate deploy'
```

## TASMAS

Process one recording manually (skips the watcher):

```bash
docker compose run --rm tasmas python3 /app/tasmas/process_flac_zip.py /mnt/media8tb/craig-recordings/RECORDING_ID.flac.zip
```

Re-trigger AI summarization for an already-transcribed recording:

```bash
./tasmas/test/test-summary.sh RECORDING_ID
```

Check recording state (processing / completed / failed):

```bash
cat /mnt/media8tb/craig-recordings/tasmas/recordings.lock.json | python3 -m json.tool
```

Restart the TASMAS sidecar after editing Python files:

```bash
docker compose restart tasmas
```