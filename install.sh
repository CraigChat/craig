#!/bin/bash

set -e

###################################################
# Variable definitions
###################################################

APT_DEPENDENCIES=(
  make              # cook
  inkscape          # cook
  ffmpeg            # cook
  flac              # cook
  vorbis-tools      # cook
  opus-tools        # cook
  zip               # cook
  unzip             # cook
  lsb-release       # redis
  curl              # redis
  gpg               # redis
  postgresql        # web
  dbus-x11          # install
  sed               # install
  coreutils         # install
  build-essential   # install
  python-setuptools # install
)

# Get the directory of the script being executed
# this lets us call the function from anywhere and it will work
craig_dir=$(dirname "$(realpath "$0")")

###################################################
# Function definitions
###################################################

usage() {
  cat <<EOS
Install Craig for local development
Usage: install.sh [options]

options:
    -h, --help       Display this message.

Please modify file 'install_config' located in the main directory of Craig with 
values for the Discord bot environment variables

  - DISCORD_BOT_TOKEN
  - DISCORD_APP_ID
  - CLIENT_ID
  - CLIENT_SECRET
  - DEVELOPMENT_GUILD_ID (optional)

This script will prompt for sudo password so that it can automatically install
packages and configure PostgreSQL. 

Various steps are required to run local instances of Craig.
The steps are summarized below:

  1) Install apt and react packages
  2) Start Redis
  3) Start PostgreSQL
  4) Config environment
  5) Configure react and yarn
  6) Build audio processing utilities
  7) Start application

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

install_apt_packages() {
  info "Updating and upgrading apt packages..."
  sudo apt-get update
  sudo apt-get -y upgrade

  info "Installing apt dependencies..."
  for package in "${APT_DEPENDENCIES[@]}"
  do
    sudo apt-get -y install "$package"
  done

  # Add redis repository to apt index and install it
  # for more info, see: https://redis.io/docs/install/install-redis/install-redis-on-linux/
  curl -fsSL https://packages.redis.io/gpg | sudo gpg --yes --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/redis.list
  sudo apt-get update || true
  sudo apt-get -y install redis
}

install_node() {
  # Install and run node (must come before npm install because npm is included with node)
  # we have to source nvm first otherwise in this non-interactive script it will not be available
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  
  # There is a version error raised somewhere in "nvm.sh"
  # because of set -e at the top of this script, we need to add the || true
  source ~/.nvm/nvm.sh || true

  nvm install $NODE_VERSION
  nvm use $NODE_VERSION

  # Install yarn globally to avoid creating package-lock.json file
  npm install -g yarn
  npm install -g pm2
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
  )
  create_env_file "$craig_dir/.env" "${env_names[@]}"

  env_names=(
    "DATABASE_URL"
  )
  create_env_file "$craig_dir/prisma/.env" "${env_names[@]}"

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
  )

  create_env_file "$craig_dir/apps/dashboard/.env" "${env_names[@]}"

  env_names=(
    "API_PORT"
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

  sed -z -E -i "s/(dexare:.*token:\s*)('')(.*applicationID:\s*)('')/\
  \1'$DISCORD_BOT_TOKEN'\3'$DISCORD_APP_ID'/"\
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

  # build
  yarn run build

  # sync Discord slash commands globally
  yarn run sync

  # only sync Discord slash commands to the guild
  # specified by DEVELOPMENT_GUILD_ID in install.config
  # yarn run sync:dev 
}

config_cook(){
  info "Building cook..."
  mkdir -p "$craig_dir/rec"
  "$craig_dir/scripts/buildCook.sh"
  "$craig_dir/scripts/downloadCookBuilds.sh"
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

  # Prompt for sudo up front for installing
  # packages and configuring PostgreSQL
  info "This script requires sudo privileges to run"

  if ! sudo -v; then
    error "Sudo password entry was cancelled or incorrect."
    exit 1 
  fi

  source "$craig_dir/install.config"

  # check if user is using linux
  OS="$(uname)"
  if [[ "${OS}" != "Linux" ]]
  then
    error "Craig is only supported on Linux."
    exit 1
  fi

  info "Now installing Craig..."
  info "Start time: $(date +%H:%M:%S)"

  install_apt_packages
  install_node
  config_env
  config_react
  config_yarn
  config_cook

  info "Craig installation finished..."
  info "End time: $(date +%H:%M:%S)"
  info "Log output: $craig_dir/install.log"

} 2>&1 | tee "$craig_dir/install.log"
