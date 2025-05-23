#!/bin/bash

set -e

###################################################
# Variable definitions
###################################################

# Get the directory of the script being executed
# this lets us call the function from anywhere and it will work
craig_dir=$(dirname "$(realpath "$0")")

#Get the init system
init_system=$(ps --no-headers -o comm 1)



#List of files that may contain personal information
PII_FILES=(
  "$HOME/.pm2"
  "$HOME/.bash_history"
  #"$craig_dir/install.config" #wait, nope
  "$craig_dir/.env"
  "$craig_dir/apps/dashboard/.env"
  "$craig_dir/apps/download/.env"
  "$craig_dir/apps/bot/.env"
  "$craig_dir/apps/bot/config/default.js"
  "$craig_dir/apps/tasks/config/default.js"
  "$craig_dir/node_modules/craig-bot/.env"
  "$craig_dir/node_modules/craig-dashboard/.env"
  "$craig_dir/node_modules/craig-horse/.env"
  "$craig_dir/node_modules/craig-bot/config/default.js"
  "$craig_dir/node_modules/craig-tasks/config/default.js"
)

declare -A defaults=(
  [PATREON_CLIENT_ID]=test \
  [PATREON_CLIENT_SECRET]=test\
  [PATRON_TIER_MAP]={\"00001\":2,\"0002\":3}\
  [PATREON_WEBHOOK_SECRET]=test\
  [GOOGLE_CLIENT_ID]=test\
  [GOOGLE_CLIENT_SECRET]=test\
  [MICROSOFT_CLIENT_ID]=test\
  [MICROSOFT_CLIENT_SECRET]=test\
  [DROPBOX_CLIENT_ID]=test\
  [DROPBOX_CLIENT_SECRET]=test\
  [APP_URI]=http://localhost:3000\
  [JWT_SECRET]=1234\
  [API_PORT]=5029\
  [API_HOST]=127.0.0.1\
  [API_HOMEPAGE]=https://craig.chat/\
  [ENNUIZEL_BASE]=https://ez.craig.horse/\
  [SENTRY_SAMPLE_RATE]=1.0\
  [SENTRY_SAMPLE_RATE_API]=1.0\
  [SERVER_NAME]=dev\
  [NODE_VERSION]="18.18.2"\
  [DATABASE_NAME]="craig"\
  [POSTGRESQL_USER]="$(whoami)"\
  [POSTGRESQL_PASSWORD]="craig"\
  [POSTGRESQL_START_TIMEOUT_S]=35\
  [REDIS_START_TIMEOUT_S]=35\
  [DATABASE_URL]=\"postgresql://$POSTGRESQL_USER:$POSTGRESQL_PASSWORD@localhost:5432/$DATABASE_NAME?schema]=public\"
)


###################################################
# Function definitions
###################################################

usage() {
  cat <<EOS
Run Craig for local development
Usage: start.sh [options]

options:
    -h, --help       Display this message.

Please modify file 'install_config' located in the main directory of Craig with 
values for the Discord bot environment variables

  - DISCORD_BOT_TOKEN
  - DISCORD_APP_ID
  - CLIENT_ID
  - CLIENT_SECRET
  - DEVELOPMENT_GUILD_ID (optional)

Various steps are required to run local instances of Craig.
The steps are summarized below:

  1) Check existing Config environment
  2) Start Redis
  3) Start PostgreSQL
  4) Config environment
  5) Configure react and yarn
  6) Start application

If all steps are successfully ran, you can monitor the application using the 'pm2' utility:

  pm2 monit

EOS
  exit "${1:-0}"
}

warning() {
    echo "[Craig][Warning]: $1"
}

error() {
    echo "[Craig][Error]: $1" >&2
}

info() {
    echo "[Craig][Info]: $1"
}


clean_running_container() {
  for pii_file in "${PII_FILES[@]}"
  do
    rm -rf "$pii_file"
  done
  #If no install.config mounted then try to create one from container ENVs
  if ! [ -f "$craig_dir/install.config" ]; then
    
    #Assign default values if variables not set. This is dirty but using default values for variables should be implemented somewhere else.
    for key in "${!defaults[@]}"; do 
      if ! [ -v "$key" ]; then
        export "$key"="${defaults[$key]}"
      fi
    done

    # Set and create config file
    env_names=(
    "DISCORD_BOT_TOKEN"
    "DISCORD_APP_ID"
    "CLIENT_ID"
    "CLIENT_SECRET"
    "DEVELOPMENT_GUILD_ID"
    "PATREON_CLIENT_ID"
    "PATREON_CLIENT_SECRET"
    "PATRON_TIER_MAP"
    "PATREON_WEBHOOK_SECRET"
    "GOOGLE_CLIENT_ID"
    "GOOGLE_CLIENT_SECRET"
    "MICROSOFT_CLIENT_ID"
    "MICROSOFT_CLIENT_SECRET"
    "DROPBOX_CLIENT_ID"
    "DROPBOX_CLIENT_SECRET"
    "APP_URI"
    "JWT_SECRET"
    "API_PORT"
    "API_HOST"
    "API_HOMEPAGE"
    "ENNUIZEL_BASE"
    "TRUST_PROXY"
    "SENTRY_DSN"
    "SENTRY_HOST"
    "SENTRY_SAMPLE_RATE"
    "SENTRY_DSN_API"
    "SENTRY_ENV"
    "SENTRY_SAMPLE_RATE_API"
    "INFLUX_URL"
    "INFLUX_TOKEN"
    "INFLUX_ORG"
    "INFLUX_BUCKET"
    "SERVER_NAME"
    "REDIS_HOST"
    "REDIS_PORT"
    "NODE_VERSION"
    "DATABASE_NAME"
    "POSTGRESQL_USER"
    "POSTGRESQL_PASSWORD"
    "POSTGRESQL_START_TIMEOUT_S"
    "REDIS_START_TIMEOUT_S"
    "DATABASE_URL"
    )

    create_env_file "$craig_dir/install.config" "${env_names[@]}"
  fi

}


start_redis() {

  local start_time_s
  local current_time_s

  # otherwise 'redis-server' will not be found if this function
  # is ran separately
  source ~/.nvm/nvm.sh || true
  nvm use $NODE_VERSION

  # start redis and check if it is running, timeout if it hasn't started
  info "Starting Redis server..."

  if ! redis-cli ping | grep -q "PONG"
  then
    if [[ $init_system == "systemd" ]]
    then
      sudo systemctl enable --now redis-server # is disabled by default
    else
      redis-server --daemonize yes #in case there is no systemd. In the future we can check sysv, systemd and others
    fi
    start_time_s=$(date +%s)

    while ! redis-cli ping | grep -q "PONG"
    do
      current_time_s=$(date +%s)
      sleep 1 # otherwise we get a bunch of connection refused errors

      if [[ $current_time_s-$start_time_s -ge $REDIS_START_TIMEOUT_S ]]
      then
        error "Redis server is not running or not accepting connections"
        info "Make sure Redis was successfully installed and rerun this script"
        info "You can also try increasing the REDIS_START_TIMEOUT_S value (currently $REDIS_START_TIMEOUT_S seconds)"
        exit 1
      fi
    done 
  fi

}

start_postgresql() {

  local start_time_s
  local current_time_s

  info "Starting PostgreSQL server..."

  if ! pg_isready
  then
    if [[ $init_system ==  "systemd" ]]
    then
      sudo systemctl enable --now postgresql # is enabled by default
    else
      sudo /etc/init.d/postgresql start #in case there is no systemd. In the future we can check sysv, systemd and others
    fi

    start_time_s=$(date +%s)

    while ! pg_isready
    do
      current_time_s=$(date +%s)
      sleep 1 # otherwise we get a bunch of connection refused errors

      if [[ $current_time_s-$start_time_s -ge $POSTGRESQL_START_TIMEOUT_S ]]
      then
        error "PostgreSQL server is not running or not accepting connections"
        info "Make sure PostgreSQL was successfully installed and rerun this script"
        info "You can also try increasing the POSTGRESQL_START_TIMEOUT_S value (currently $POSTGRESQL_START_TIMEOUT_S seconds)"
        exit 1
      fi
    done 
  fi


  # create postgreSQL database if it doesn't already exist
  if sudo -u postgres -i psql -lqt | cut -d \| -f 1 | grep -qw "$DATABASE_NAME"
  then
    info "PostgreSQL database '$DATABASE_NAME' already exists."
  else
    # we need to be the postgres superuser to create a db
    # -i to avoid the "could not  change directory to '...': Permission denied message"
    sudo -u postgres -i createdb $DATABASE_NAME
  fi 

  # Don't know if this is strictly needed, but add user to run this database

  # Check if user exists
  if ! sudo -u postgres -i psql -t -c '\du' | cut -d \| -f 1 | grep -qw "$POSTGRESQL_USER"
  then
    # Create user if it doesn't exist
    sudo -u postgres -i psql -c "CREATE USER $POSTGRESQL_USER WITH PASSWORD '$POSTGRESQL_PASSWORD';"
  else
    info "PostgreSQL user '$POSTGRESQL_USER' already exists."
  fi

  sudo -u postgres -i psql -c "GRANT ALL PRIVILEGES ON DATABASE $DATABASE_NAME TO $POSTGRESQL_USER;"
  sudo -u postgres -i psql -c "GRANT ALL ON SCHEMA public TO $POSTGRESQL_USER;"
  sudo -u postgres -i psql -c "GRANT USAGE ON SCHEMA public TO $POSTGRESQL_USER;"
  sudo -u postgres -i psql -c "ALTER DATABASE $DATABASE_NAME OWNER TO $POSTGRESQL_USER;"
  
  sudo -u postgres -i psql -c "\l" # unnecessary but just for debugging
}


create_env_file() {
  local output_file="$1"
  local variable_names=("${@:2}")

  # recreate if it already exists
  > "$output_file"

  # output the name of the env variable and its value
  for var_name in "${variable_names[@]}"; do
      echo "$var_name=${!var_name}" >> "$output_file"
  done  

}

config_env() {
  local env_names

  info "Configuring environment..."

  env_names=(
    "DISCORD_BOT_TOKEN"
    "DISCORD_APP_ID"
    "DEVELOPMENT_GUILD_ID"
    "DATABASE_URL"
  )
  create_env_file "$craig_dir/.env" "${env_names[@]}"

  env_names=(
    "CLIENT_ID"
    "CLIENT_SECRET"
    "PATREON_CLIENT_ID"
    "PATREON_CLIENT_SECRET"
    "PATRON_TIER_MAP"
    "PATREON_WEBHOOK_SECRET"
    "GOOGLE_CLIENT_ID"
    "GOOGLE_CLIENT_SECRET"
    "MICROSOFT_CLIENT_ID"
    "MICROSOFT_CLIENT_SECRET"
    "DROPBOX_CLIENT_ID"
    "DROPBOX_CLIENT_SECRET"
    "APP_URI"
    "JWT_SECRET"
    "DATABASE_URL"
  )

  create_env_file "$craig_dir/apps/dashboard/.env" "${env_names[@]}"

  env_names=(
    "API_PORT"
    "API_HOST"
    "API_HOMEPAGE"
    "ENNUIZEL_BASE"
    "TRUST_PROXY"
    "SENTRY_DSN"
    "SENTRY_HOST"
    "SENTRY_SAMPLE_RATE"
    "SENTRY_DSN_API"
    "SENTRY_ENV"
    "SENTRY_SAMPLE_RATE_API"
    "INFLUX_URL"
    "INFLUX_TOKEN"
    "INFLUX_ORG"
    "INFLUX_BUCKET"
    "SERVER_NAME"
    "REDIS_HOST"
    "REDIS_PORT"
  )

  create_env_file "$craig_dir/apps/download/.env" "${env_names[@]}"

  env_names=(
    "DISCORD_BOT_TOKEN"
    "DISCORD_APP_ID"
    "DEVELOPMENT_GUILD_ID"
    "DATABASE_URL"
  )

  create_env_file "$craig_dir/apps/bot/.env" "${env_names[@]}"

}

config_react(){

  info "Configuring react..."

  cp "$craig_dir/apps/bot/config/_default.js" "$craig_dir/apps/bot/config/default.js" 
  cp "$craig_dir/apps/tasks/config/_default.js" "$craig_dir/apps/tasks/config/default.js" 

  # not very elegant, but here's some sed magic in order to update the javascript file with the required values
  # we are regexing the following pattern and replacing the 2nd and 4th capture group
  # with the appropiate environment values
  #
  # ----------------------------
  # dexare: {
  #   // Bot token
  #   token: '',
  #   // Application ID
  #   applicationID: '',
  # ----------------------------

  DOWNLOAD_DOMAIN=$(echo $API_HOMEPAGE|awk -F'://' '{print $2}')
  sed -z -E -i'' "s/(dexare:.*token:\s*)('')(.*applicationID:\s*)('')(.*downloadDomain:\s*)('localhost:5029')/\
  \1'${DISCORD_BOT_TOKEN}'\3'${DISCORD_APP_ID}'\5'${DOWNLOAD_DOMAIN//\//\\/}'/" \
  "$craig_dir/apps/bot/config/default.js"


  # here's some more sed magic. this task isn't needed for local builds
  # we are regexing the following pattern and replacing the 2nd capture 
  # group with the ignored task
  #
  # -------------------------------
  # tasks: {
  #   ignore: []
  # -------------------------------

  sed -z -E -i "s/(tasks:.*ignore:\s*)(\[\s*\])/\
  \1[\"refreshPatrons\"]/"\
  "$craig_dir/apps/tasks/config/default.js"

}

config_yarn(){

  info "Configuring yarn..."

  # install dependencies
  yarn install

  # config prisma
  yarn prisma:generate
  yarn prisma:deploy

  # build
  yarn run build

  # sync Discord slash commands globally
  yarn run sync

  # only sync Discord slash commands to the guild
  # specified by DEVELOPMENT_GUILD_ID in install.config
  # yarn run sync:dev 
}

start_app(){

  # otherwise 'pm2' will not be found if this function
  # is ran separately
  source ~/.nvm/nvm.sh || true
  nvm use $NODE_VERSION

  info "Starting Craig..."

  cd "$craig_dir/apps/bot" && pm2 start "ecosystem.config.js"
  cd "$craig_dir/apps/dashboard" && pm2 start "ecosystem.config.js"
  cd "$craig_dir/apps/download" && pm2 start "ecosystem.config.js"
  cd "$craig_dir/apps/tasks" && pm2 start "ecosystem.config.js"

  pm2 save

  cd "$craig_dir"
}


###################################################
# Main script commands
###################################################

{ 
  # Parse command-line options
  while [[ $# -gt 0 ]]
  do
    case "$1" in
      -h | --help)
        usage ;;
      *)
        warning "Unrecognized option: '$1'"
        usage 1
        ;;
    esac
  done
  # if root, install sudo
  if [ "$(whoami)" == "root" ]; then
    apt-get install -y sudo
  else
      error "Make sure sudo is installed and run again."
  fi

  # Prompt for sudo up front for installing
  # packages and configuring PostgreSQL
  info "This script requires sudo privileges to run"

  if ! sudo -v; then
    error "Sudo password entry was cancelled or incorrect."
    exit 1 
  fi

  # Cleanup if running inside container
  if [ -f /.dockerenv ] || [ grep -sq 'docker\|lxc' /proc/1/cgroup ]; then
    in_container=true;
    clean_running_container
  else
    in_container=false;
  fi
  
  source "$craig_dir/install.config"

  # check if user is using linux
  OS="$(uname)"
  if [[ "${OS}" != "Linux" ]]
  then
    error "Craig is only supported on Linux."
    exit 1
  fi

  info "Now starting Craig..."
  info "Start time: $(date +%H:%M:%S)"


  start_redis
  start_postgresql
  if [ in_container ]; then
      config_env
      config_react
      config_yarn
  fi
  start_app
  pm2 logs

  info "Craig shutdown..."
  info "End time: $(date +%H:%M:%S)"
  info "Log output: $craig_dir/startup.log"

} 2>&1 | tee "$craig_dir/startup.log"