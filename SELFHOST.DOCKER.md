# Deploying Craig with Docker

A production image is published to GHCR on every merge to `master`.

## Setup

1. Copy the compose file and config template to your server:

   ```sh
   cp docker-compose.production.yml ~/craig/docker-compose.yml
   cp install.config.example ~/craig/install.config
   ```

2. Fill in your secrets in `install.config` (Discord token, database password, etc.).

3. Start:

   ```sh
   docker compose -f ~/craig/docker-compose.yml up -d
   ```

## Updating

```sh
docker compose -f ~/craig/docker-compose.yml pull craig
docker compose -f ~/craig/docker-compose.yml up -d craig
```
