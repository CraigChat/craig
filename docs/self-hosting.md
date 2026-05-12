# Self-hosting Craig AI

Craig AI runs entirely in Docker. See `install.config.example` for the full configuration reference.

For bare-metal installation, see [SELFHOST.md](../SELFHOST.md).

## Prerequisites

- Linux host
- Docker and Docker Compose plugin

## Setup

**1. Create a Discord bot** at the [Discord Developer Portal](https://discord.com/developers/applications). You need the bot token, application ID, client ID, and client secret. Add `http://localhost:3000/api/login` as an OAuth2 redirect URI.

**2. Configure the environment:**

```sh
cp ./install.config.example ./install.config
```

Fill in the Discord credentials and set `DATABASE_URL` to point to the `db` Compose service. See the recommended changes section in `install.config.example` for `API_HOST`, `API_HOMEPAGE`, and `RECORDING_RETENTION_DAYS`.

**3. (Optional) Configure AI summarization** — set `NVIDIA_API_KEY` and/or `SUMMARY_FALLBACK_CHAIN` in `install.config`. See [ai-summarization.md](ai-summarization.md).

**4. Build and start:**

```sh
docker compose build && docker compose up -d
```

**5. Invite the bot** to a Discord server via the OAuth2 URL (replace `CLIENT_ID`):

```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=68176896&scope=bot%20applications.commands
```

**6. Start the TASMAS sidecar** (optional, for transcription):

```sh
docker compose up -d tasmas
```

## Access

- Dashboard: `http://localhost:3000/login`
- Download server: `http://localhost:5029`

> When running locally, recording links use `https://` — change to `http://` in your browser since localhost has no signed certificate.
