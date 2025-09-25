#!/bin/bash

set -e

if [ -f /.dockerenv ] || grep -qE 'docker|kubepods|containerd' /proc/1/cgroup; then
  SUDO=""
else
  SUDO="sudo"
fi

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
  $SUDO apt-get update
  $SUDO apt-get -y upgrade

  info "Installing apt dependencies..."
  for package in "${APT_DEPENDENCIES[@]}"; do
    $SUDO apt-get -y install "$package"
  done

  # Add redis repository to apt index and install it
  # for more info, see: https://redis.io/docs/install/install-redis/install-redis-on-linux/
  curl -fsSL https://packages.redis.io/gpg | $SUDO gpg --yes --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" | $SUDO tee /etc/apt/sources.list.d/redis.list
  $SUDO apt-get update || true
  $SUDO apt-get -y install redis
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

config_yarn() {

  info "Configuring yarn..."

  # Make sure NVM environment is loaded
  # shellcheck disable=SC1090
  source ~/.nvm/nvm.sh || true
  nvm use "$NODE_VERSION"

  # install dependencies
  yarn install

  # rebuild native modules to ensure compatibility
  npm rebuild

  # build
  yarn run build

  # Note: Discord slash commands will be deployed at runtime by run.sh

  # only sync Discord slash commands to the guild
  # specified by DEVELOPMENT_GUILD_ID in install.config
  # yarn run sync:dev
}

config_cook() {
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
  while [[ $# -gt 0 ]]; do
    case "$1" in
    -h | --help)
      usage
      ;;
    *)
      warning "Unrecognized option: '$1'"
      usage 1
      ;;
    esac
  done

  if ! [ -f /.dockerenv ] && ! grep -qE 'docker|kubepods|containerd' /proc/1/cgroup; then
    # Prompt for sudo up front for installing
    # packages and configuring PostgreSQL
    info "This script requires sudo privileges to run"

    if ! sudo -v; then
      error "Sudo password entry was cancelled or incorrect."
      exit 1
    fi
  fi
  # check if user is using linux
  OS="$(uname)"
  if [[ "${OS}" != "Linux" ]]; then
    error "Craig is only supported on Linux."
    exit 1
  fi

  info "Now installing Craig..."
  info "Start time: $(date +%H:%M:%S)"

  install_apt_packages
  install_node
  config_yarn
  config_cook

  info "Craig installation finished..."
  info "End time: $(date +%H:%M:%S)"
  info "Log output: $craig_dir/install.log"

} 2>&1 | tee "$craig_dir/install.log"
