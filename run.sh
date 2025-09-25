#!/bin/bash

set -e

if [ -f /.dockerenv ] || grep -qE 'docker|kubepods|containerd' /proc/1/cgroup; then
  IS_CONTAINER=true
  SUDO=""
else
  IS_CONTAINER=false
  SUDO="sudo"
fi

craig_dir=$(dirname "$(realpath "$0")")

warning() {
  echo "[Craig][Warning]: $1"
}

error() {
  echo "[Craig][Error]: $1" >&2
}

info() {
  echo "[Craig][Info]: $1"
}

start_redis() {

  local start_time_s
  local current_time_s

  # otherwise 'redis-server' will not be found if this function
  # is ran separately
  # shellcheck disable=SC1090
  source ~/.nvm/nvm.sh || true
  nvm use "$NODE_VERSION"

  # start redis and check if it is running, timeout if it hasn't started
  info "Starting Redis server..."

  set +e

  if ! redis-cli -h "$REDIS_HOST" ping | grep -q "PONG"; then
    if [ "$IS_CONTAINER" = false ]; then
      $SUDO systemctl enable --now redis-server # is disabled by default
    fi

    start_time_s=$(date +%s)

    while ! redis-cli -h "$REDIS_HOST" ping | grep -q "PONG"; do
      current_time_s=$(date +%s)
      sleep 1 # otherwise we get a bunch of connection refused errors

      if [[ $current_time_s-$start_time_s -ge $REDIS_START_TIMEOUT_S ]]; then
        error "Redis server is not running or not accepting connections"
        info "Make sure Redis was successfully installed and rerun this script"
        info "You can also try increasing the REDIS_START_TIMEOUT_S value (currently $REDIS_START_TIMEOUT_S seconds)"
        exit 1
      fi
    done
  fi

  set -e

}

start_postgresql() {

  local start_time_s
  local current_time_s

  # Set password for PostgreSQL authentication
  export PGPASSWORD="$POSTGRESQL_PASSWORD"

  info "Starting PostgreSQL server..."

  set +e

  if ! pg_isready -h "$POSTGRESQL_HOST"; then
    if [ "$IS_CONTAINER" = false ]; then
      $SUDO systemctl enable --now postgresql # is enabled by default
    fi

    start_time_s=$(date +%s)

    while ! pg_isready -h "$POSTGRESQL_HOST"; do
      current_time_s=$(date +%s)
      sleep 1 # otherwise we get a bunch of connection refused errors

      if [[ $current_time_s-$start_time_s -ge $POSTGRESQL_START_TIMEOUT_S ]]; then
        error "PostgreSQL server is not running or not accepting connections"
        info "Make sure PostgreSQL was successfully installed and rerun this script"
        info "You can also try increasing the POSTGRESQL_START_TIMEOUT_S value (currently $POSTGRESQL_START_TIMEOUT_S seconds)"
        exit 1
      fi
    done
  fi

  set -e

  # create postgreSQL database if it doesn't already exist
  if psql -h "$POSTGRESQL_HOST" -U postgres -lqt | cut -d \| -f 1 | grep -qw "$DATABASE_NAME"; then
    info "PostgreSQL database '$DATABASE_NAME' already exists."
  else
    # we need to be the postgres superuser to create a db
    # -i to avoid the "could not  change directory to '...': Permission denied message"
    createdb -h "$POSTGRESQL_HOST" "$DATABASE_NAME" -U postgres
  fi

  # Don't know if this is strictly needed, but add user to run this database

  # Check if user exists
  if ! psql -U postgres -h "$POSTGRESQL_HOST" -t -c '\du' | cut -d \| -f 1 | grep -qw "$POSTGRESQL_USER"; then
    # Create user if it doesn't exist
    psql -U postgres -h "$POSTGRESQL_HOST" -c "CREATE USER $POSTGRESQL_USER WITH PASSWORD '$POSTGRESQL_PASSWORD';"
  else
    info "PostgreSQL user '$POSTGRESQL_USER' already exists."
  fi

  psql -U postgres -h "$POSTGRESQL_HOST" -c "GRANT ALL PRIVILEGES ON DATABASE $DATABASE_NAME TO $POSTGRESQL_USER;"
  psql -U postgres -h "$POSTGRESQL_HOST" -c "GRANT ALL ON SCHEMA public TO $POSTGRESQL_USER;"
  psql -U postgres -h "$POSTGRESQL_HOST" -c "GRANT USAGE ON SCHEMA public TO $POSTGRESQL_USER;"
  psql -U postgres -h "$POSTGRESQL_HOST" -c "ALTER DATABASE $DATABASE_NAME OWNER TO $POSTGRESQL_USER;"

  psql -U postgres -h "$POSTGRESQL_HOST" -c "\l" # unnecessary but just for debugging
}

start_app() {

  # otherwise 'pm2' will not be found if this function
  # is ran separately
  # shellcheck disable=SC1090
  source ~/.nvm/nvm.sh || true
  nvm use "$NODE_VERSION"

  info "Starting Craig..."

  cd "$craig_dir/apps/bot" && pm2 start "ecosystem.config.js"
  cd "$craig_dir/apps/dashboard" && pm2 start "ecosystem.config.js"
  cd "$craig_dir/apps/download" && pm2 start "ecosystem.config.js"
  cd "$craig_dir/apps/tasks" && pm2 start "ecosystem.config.js"

  pm2 save

  cd "$craig_dir"
}

{
  # shellcheck disable=SC1091
  set -o allexport
  if [ -f "$craig_dir/.env" ]; then
    source "$craig_dir/.env"
  fi
  set +o allexport

  start_redis
  start_postgresql

  # config prisma
  yarn prisma:generate
  yarn prisma:deploy

  start_app

  # Give the bot a moment to initialize before deploying slash commands
  info "Waiting for bot to initialize before deploying slash commands..."
  sleep 10

  # Deploy Discord slash commands now that the bot is running
  info "Deploying Discord slash commands..."
  cd "$craig_dir/apps/bot"
  # shellcheck disable=SC1090
  source ~/.nvm/nvm.sh || true
  nvm use "$NODE_VERSION"

  if [ -n "$DEVELOPMENT_GUILD_ID" ]; then
    info "Deploying slash commands to development guild..."
    if yarn run sync:dev; then
      info "✅ Development slash commands deployed successfully"
    else
      warning "❌ Development slash command deployment failed, trying global deployment..."
      if yarn run sync; then
        info "✅ Global slash commands deployed successfully"
      else
        warning "❌ Slash command deployment failed - commands can be deployed manually later"
      fi
    fi
  else
    info "Deploying slash commands globally..."
    if yarn run sync; then
      info "✅ Global slash commands deployed successfully"
    else
      warning "❌ Slash command deployment failed - commands can be deployed manually later"
    fi
  fi

  cd "$craig_dir"
} 2>&1 | tee "$craig_dir/running.log"

tail -f /dev/null
