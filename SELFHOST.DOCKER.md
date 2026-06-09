# Deploying Craig with Docker

Production images are published to GHCR on every merge to `master`. Each service has its own image:

- `ghcr.io/mhd-hi/craig/bot:latest`
- `ghcr.io/mhd-hi/craig/dashboard:latest`
- `ghcr.io/mhd-hi/craig/download:latest`
- `ghcr.io/mhd-hi/craig/tasks:latest`

## Setup

1. Copy the compose file and config template to your server:

   ```sh
   cp docker-compose.production.yml ~/craig/docker-compose.yml
   cp install.config.example ~/craig/install.config
   ```

2. Fill in your secrets in `install.config` (Discord token, database password, etc.).

3. Pull all images and start:

   ```sh
   docker compose pull
   docker compose up -d
   ```

   The `migrate` service runs automatically on first start and applies any pending database migrations, then exits. All other services start after it completes.

## Updating

```sh
docker compose pull
docker compose up -d
```

Compose pulls all four images and restarts any service whose image has changed.

## Logs

```sh
docker compose logs -f bot
docker compose logs -f dashboard
docker compose logs -f download
docker compose logs -f tasks
```
