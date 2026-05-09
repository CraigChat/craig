# Useful Commands

Run these from the Craig repo root:

```bash
cd /root/projects/docker/craig-whisperr/craig
```

## Docker

Build the image and start the stack in the background:

```bash
docker compose build && docker compose up -d
```

Rebuild and recreate only the Craig service:

```bash
docker compose up -d --build craig
```

Show running containers:

```bash
docker ps
```

Check Craig services inside the container:

```bash
docker exec craig-craig-1 bash -lc 'source /root/.nvm/nvm.sh && nvm use "${NODE_VERSION:-20}" >/dev/null && pm2 list'
```

View Craig container logs:

```bash
docker logs -f craig-craig-1
```

## Build And Typecheck

Build every workspace:

```bash
docker exec craig-craig-1 bash -lc 'source /root/.nvm/nvm.sh && nvm use "${NODE_VERSION:-20}" >/dev/null && cd /app && yarn build'
```

Build only the bot:

```bash
docker exec craig-craig-1 bash -lc 'source /root/.nvm/nvm.sh && nvm use "${NODE_VERSION:-20}" >/dev/null && cd /app && yarn workspace craig-bot build'
```

Build only the tasks service:

```bash
docker exec craig-craig-1 bash -lc 'source /root/.nvm/nvm.sh && nvm use "${NODE_VERSION:-20}" >/dev/null && cd /app && yarn workspace craig-tasks build'
```

Typecheck the tasks service:

```bash
docker exec craig-craig-1 bash -lc 'source /root/.nvm/nvm.sh && nvm use "${NODE_VERSION:-20}" >/dev/null && cd /app/apps/tasks && yarn tsc --noEmit'
```

## Environment Checks

Verify the public recording URL base:

```bash
docker exec craig-craig-1 printenv API_HOMEPAGE
```

Verify a recording link shape:

```bash
docker exec craig-craig-1 bash -lc 'source /root/.nvm/nvm.sh && nvm use "${NODE_VERSION:-20}" >/dev/null && node -e "const api = new URL(process.env.API_HOMEPAGE); console.log(api.protocol + \"//\" + api.host + \"/rec/RECORDING_ID?key=ACCESS_KEY\")"'
```
