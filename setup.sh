#!/usr/bin/env bash
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/mhd-hi/craig-ai/master"
DIR="${1:-craig}"

echo "Setting up Craig in ./$DIR"
mkdir -p "$DIR"
cd "$DIR"

curl -fsSL "$REPO_RAW/docker-compose.yml"  -o docker-compose.yml
curl -fsSL "$REPO_RAW/.env.example"        -o .env.example

if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo ".env created from .env.example"
else
  echo ""
  echo ".env already exists — not overwritten (updated .env.example is at .env.example)"
fi

echo ""
echo "Next steps:"
echo "  1. Edit .env — fill in DISCORD_BOT_TOKEN, DISCORD_APP_ID, CLIENT_ID, CLIENT_SECRET,"
echo "                       JWT_SECRET, CRAIG_INTERNAL_SECRET, NEXTAUTH_SECRET,"
echo "                       API_HOMEPAGE, APP_URI, CRAIG_RECORDINGS_DIR, POSTGRES_PASSWORD"
echo "  2. docker compose pull"
echo "  3. docker compose up -d"
echo ""
echo "Full guide: https://github.com/mhd-hi/craig-ai/blob/master/SELFHOST.DOCKER.md"
