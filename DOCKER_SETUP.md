# Docker Setup (Docker Compose)

This is the simplified Docker-based setup using Docker Compose.

## Prerequisites

- Docker and Docker Compose installed on your system
- Discord Bot Application configured (see SELFHOST.md steps 2a-2e)

## Setup Instructions

### 1. Clone the repository

```sh
git clone --recurse-submodules https://github.com/CraigChat/craig.git
cd craig
```

### 2. Configure environment variables

Copy the example environment file:

```sh
cp .env.example .env
```

Edit the `.env` file with your Discord bot configuration:

```env
# Required Discord Bot Configuration
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_APP_ID=your_application_id_here
CLIENT_ID=your_application_id_here        # Same as DISCORD_APP_ID
CLIENT_SECRET=your_client_secret_here

# Optional: Development server for faster slash command sync
DEVELOPMENT_GUILD_ID=your_test_server_id_here

# Database Configuration (change the password!)
POSTGRES_PASSWORD=your_secure_password_here
```

**Important Notes:**
- `DISCORD_APP_ID` and `CLIENT_ID` must be the same value
- Change `POSTGRES_PASSWORD` to a secure password
- Set `DEVELOPMENT_GUILD_ID` for faster command deployment during development

### 3. Start the services

```sh
docker compose up -d
```

This will:
- Build the Craig application container
- Start PostgreSQL database
- Start Redis cache
- Deploy slash commands automatically
- Start all Craig services (bot, dashboard, file hosting, tasks)

### 4. Verify the setup

Check that all services are running:

```sh
docker compose ps
```

You should see 3 containers running:
- `craig-app-1` (Craig application)
- `craig-postgres-1` (PostgreSQL database)
- `craig-redis-1` (Redis cache)

### 5. Access Craig

- **Discord Bot**: Should appear online in your Discord servers
- **Web Dashboard**: http://localhost:8080/login
- **File Downloads**: http://localhost:8080/rec/RECORDING_ID

## Troubleshooting

### Check logs

View Craig application logs:
```sh
docker compose logs app
```

View all service logs:
```sh
docker compose logs
```

### Restart services

```sh
docker compose restart
```

### Rebuild after configuration changes

```sh
docker compose down
docker compose build app
docker compose up -d
```

### Deploy slash commands manually

If slash commands aren't appearing:
```sh
docker exec craig-app-1 bash -c "source ~/.nvm/nvm.sh && nvm use 18.18.2 && cd /app && yarn run sync"
```

## Stopping Craig

```sh
docker compose down
```

## Updating Craig

```sh
git pull --recurse-submodules
docker compose build app
docker compose up -d
```