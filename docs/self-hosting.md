# Self-Hosting Craig — Production

Craig runs entirely from pre-built Docker images published to GHCR. No compiler or Node.js needed on the server.

## Prerequisites

- Linux host
- Docker and Docker Compose plugin

## Quick setup

Run this on your server to download the compose file and a pre-filled environment template (always read through the script first):

```sh
curl -fsSL https://raw.githubusercontent.com/mhd-hi/craig-ai/master/setup.sh | bash
cd craig
```

Or do it manually:

```sh
mkdir craig && cd craig
curl -fsSL https://raw.githubusercontent.com/mhd-hi/craig-ai/master/docker-compose.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/mhd-hi/craig-ai/master/.env.example -o .env.example
cp .env.example .env
```

## 1. Create a Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**
2. **Settings → General Information** → copy **APPLICATION ID** → `DISCORD_APP_ID`
3. **Settings → Bot** → copy **TOKEN** → `DISCORD_BOT_TOKEN`
4. **Settings → OAuth2 → General** → copy **CLIENT ID** → `CLIENT_ID` and **CLIENT SECRET** → `CLIENT_SECRET`
5. **Settings → OAuth2 → General** → add your dashboard URL + `/api/login` as an OAuth2 redirect URI (e.g. `https://craigboard.example.com/api/login`)

## 2. Edit .env

Open `.env` and fill in these values:

**Discord**
```
DISCORD_BOT_TOKEN=        # from step 1
DISCORD_APP_ID=           # from step 1
CLIENT_ID=                # from step 1
CLIENT_SECRET=            # from step 1
```

**Secrets — generate a random value for each**
```
JWT_SECRET=               # openssl rand -hex 32
CRAIG_INTERNAL_SECRET=    # openssl rand -hex 32
NEXTAUTH_SECRET=          # openssl rand -hex 32
```

**URLs**
```
API_HOMEPAGE=             # public URL of your download server, e.g. https://craig.example.com
APP_URI=                  # public URL of your dashboard,      e.g. https://craigboard.example.com
```

**Storage**
```
CRAIG_RECORDINGS_DIR=     # absolute path on the host, e.g. /data/craig-recordings
POSTGRES_PASSWORD=        # change from default
POSTGRESQL_PASSWORD=      # same value as above
```

**AI Summary — set at least one API key**
```
NVIDIA_API_KEY=           # https://build.nvidia.com (free tier available)
OPENROUTER_API_KEY=       # https://openrouter.ai (used as fallback)
```

All other variables (`AI_SUMMARY_MODEL`, `TASMAS_IMAGE`, GPU args, model params, etc.) have working defaults.

## 3. Start

```sh
docker compose pull
docker compose up -d
```

The `migrate` service runs automatically, applies any pending database migrations, then exits. All other services start after it completes.

## 4. Invite the bot

Replace `CLIENT_ID` with your bot's application ID:

```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=68176896&scope=bot%20applications.commands
```

## Access

| Service   | Default URL                   |
|-----------|-------------------------------|
| Dashboard | http://your-server:3000/login |
| Download  | http://your-server:5029       |

## Updating

```sh
docker compose pull
docker compose up -d
```

Compose pulls changed images and restarts only the affected services.

## Logs

```sh
docker compose logs -f bot
docker compose logs -f dashboard
docker compose logs -f download
docker compose logs -f tasks
docker compose logs -f tasmas
```

## TASMAS — Transcription & AI Summaries

TASMAS watches the recordings directory, transcribes each `.flac.zip` with Whisper, and posts an AI summary to Discord. It is optional — set at least one AI API key in step 2 to activate it, or omit both keys to skip summarization entirely.

Pre-download the Whisper model before first use (saves time on the first recording):

```sh
docker run --rm --gpus all \
  --entrypoint python \
  -v "$TASMAS_MODEL_CACHE_DIR:/root/.cache" \
  kaddaok/tasmas:latest \
  -c "import whisper_timestamped as whisper; whisper.load_model('small', device='cuda')"
```

Process one existing recording manually:

```sh
docker compose run --rm tasmas \
  python3 /app/tasmas/process_flac_zip.py "$CRAIG_RECORDINGS_DIR/RECORDING_ID.flac.zip"
```

See [tasmas.md](tasmas.md) for full details.

---

For local development (hot reload, build from source), see [development.md](development.md).
