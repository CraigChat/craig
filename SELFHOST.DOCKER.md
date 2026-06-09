# Self-hosting Craig with Docker

Craig runs entirely in Docker. There is no bare-metal installer.

## 1. Clone the repo

```sh
git clone --recurse-submodules https://github.com/mhd-hi/craig.git
cd craig
```

## 2. Create a Discord Bot application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**
2. Under **Settings → General Information**, copy the **APPLICATION ID** → `DISCORD_APP_ID`
3. Under **Settings → Bot**, copy the **TOKEN** → `DISCORD_BOT_TOKEN`
4. Under **Settings → OAuth2 → General**, copy the **CLIENT ID** → `CLIENT_ID` and **CLIENT SECRET** → `CLIENT_SECRET`
5. Under **Settings → OAuth2 → General**, add `http://localhost:3000/api/login` as an OAuth2 redirect URI and save

## 3. Configure the environment

```sh
cp install.config.example install.config
```

Fill in at minimum:

```
DISCORD_BOT_TOKEN
DISCORD_APP_ID
CLIENT_ID
CLIENT_SECRET
```

Set the database URL to use the Docker service name:

```
DATABASE_URL="postgresql://$POSTGRESQL_USER:$POSTGRESQL_PASSWORD@db:5432/$DATABASE_NAME?schema=public"
```

### Recommended changes

- **`API_HOST`** — set to `0.0.0.0` so the web GUI is reachable from other machines on the network (default `127.0.0.1` is localhost-only)
- **`API_HOMEPAGE`** — set to the IP or domain of your server so recording download links work (e.g. `http://192.168.0.10:5029`)
- **`RECORDING_RETENTION_DAYS`** — controls how long recordings stay downloadable (default `3`)

### Unlock all features for self-hosters

Replace `rewardTiers` in `apps/bot/config/_default.js` to give all users maximum access:

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

## 4. Start

### Production (pre-built images from GHCR)

Images are published automatically on every merge to `master`:

- `ghcr.io/mhd-hi/craig/bot:latest`
- `ghcr.io/mhd-hi/craig/dashboard:latest`
- `ghcr.io/mhd-hi/craig/download:latest`
- `ghcr.io/mhd-hi/craig/tasks:latest`

```sh
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml up -d
```

The `migrate` service runs automatically on first start, applies pending database migrations, then exits. All other services start after it completes.

### Development (hot reload)

```sh
docker compose -f docker-compose.dev.yml up --build
```

TypeScript apps (bot, tasks, download API) restart instantly via `tsx watch` on `.ts` file saves. The Next.js dashboard uses built-in HMR. The rollup page bundle rebuilds on change.

## 5. Invite the bot

Replace `CLIENT_ID` with your bot's actual client ID:

```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=68176896&scope=bot%20applications.commands
```

## Access

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:3000/login |
| Download server | http://localhost:5029 |

> Recording download links use `https://` — change to `http://` in your browser when running locally since localhost has no signed certificate.

## Updating

```sh
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml up -d
```

Compose pulls all images and restarts any service whose image changed.

## Logs

```sh
docker compose -f docker-compose.production.yml logs -f bot
docker compose -f docker-compose.production.yml logs -f dashboard
docker compose -f docker-compose.production.yml logs -f download
docker compose -f docker-compose.production.yml logs -f tasks
```

## TASMAS — Transcription & Summarization sidecar

TASMAS watches the recordings directory, transcribes each `.flac.zip` with Whisper, and posts an AI summary to Discord. It is optional — Craig works without it.

Configure it in `install.config` using the `TASMAS transcription sidecar` section from `install.config.example`.

```sh
docker compose -f docker-compose.production.yml up -d tasmas
```

To pre-download the Whisper model before first use:

```sh
mkdir -p /mnt/media8tb/craig-recordings/tasmas-model-cache
docker run --rm --gpus all \
  --entrypoint python \
  -v /mnt/media8tb/craig-recordings/tasmas-model-cache:/root/.cache \
  kaddaok/tasmas:latest \
  -c "import whisper_timestamped as whisper; whisper.load_model('small', device='cuda')"
```

Process one existing recording manually:

```sh
docker compose -f docker-compose.production.yml run --rm tasmas \
  python3 /app/tasmas/process_flac_zip.py /mnt/media8tb/craig-recordings/RECORDING_ID.flac.zip
```

See [docs/tasmas.md](docs/tasmas.md) for full details.
