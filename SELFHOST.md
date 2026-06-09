# Self-hosting/installation
Craig can be installed and ran locally. Some use cases for this are:
- Contributing to Craig's source code
- Creating multiple instances of Craig

## Pre-requisites/dependencies
Craig can only be ran on a Linux machine. The installation has been tested on a fresh install of **Ubuntu 22.04** and **Kubuntu 23.10**, as well as Docker.

The following `apt` packages will be automatically installed by the install script [install.sh](install.sh):

```
wget make inkscape ffmpeg flac fdkaac vorbis-tools opus-tools zip unzip lsb-release curl gpg redis postgresql dbus-x11 sed coreutils build-essential python-setuptools
```


## 1. Clone source code

```
git clone --recurse-submodules https://github.com/CraigChat/craig.git
```

## 2. Create a Discord Bot application
We need to create a Discord Bot account for the Craig instance. 

### Required steps

1. Log into [Discord](https://discord.com/)
2. Navigate to the [developer application page](https://discord.com/developers/applications)
3. Click on `New Application` in the top-right
4. Give your new Craig instance a name (e.g. *LocalCraig* or *MyCraigBot*)
5. Accept terms of service and click `Create`
6. Under `SETTINGS->General Information` take note and copy down the following:
   - **APPLICATION ID** (corresponds to `DISCORD_APP_ID`)
7. Under `SETTINGS->Bot` take note and copy down the following:
   - **TOKEN** (corresponds to `DISCORD_BOT_TOKEN`)
     - you might have to click `Reset Token` if this is hidden
8. Under `SETTINGS->OAuth2->General` take note and copy down the following:
   - **CLIENT ID** (corresponds to `CLIENT_ID`)
   - **CLIENT SECRET** (correpsonds to `CLIENT_SECRET`)
     - you might have to click `Reset Secret` if this is hidden
9. Under `SETTINGS->OAuth2->General` click on `Add Redirect` and paste in the following URI: http://localhost:3000/api/login
10. Save changes


### Optional steps

#### Upload an app icon for Craig

1. Under `SETTINGS->General Information->APP ICON` click on the photo icon
2. You can use the default one, which is located in the git repo: [apps/download/page/public/craig.png](apps/download/page/public/craig.png). I recommend changing it slightly so as not to get confused with the actual Craig bot

#### Create a development guild (server) for Craig

After installation, your self-hosted instance of Craig can be invited to any Discord server. There is an optional environment variable in [install.config.example](install.config.example) which sets the development server for synchronized slash commands: `DEVELOPMENT_GUILD_ID`. Running `yarn run sync:dev` in the main git repo will then only synchronize commands to that development sever, as opposed to all the servers your Craig bot has been invited to. This gives you a sandbox in which to test experimental slash commands.

1. Follow [this guide](https://support.discord.com/hc/en-us/articles/204849977) to create a Discord server
2. Follow [this guide](https://support.discord.com/hc/en-us/articles/206346498) to obtain your new server's ID

## 3. Edit configuration files

### Required configuration

Copy the example config file in the main directory and rename it

```sh
cp ./install.config.example ./install.config
```

Edit the following environment variables in the newly created [install.config](install.config) file with values you obtained from the previous step:

```
DISCORD_BOT_TOKEN
DISCORD_APP_ID
CLIENT_ID
CLIENT_SECRET
```
and optionally:

```
DEVELOPMENT_GUILD_ID
```

If you are using Docker, change the database URL as follows:

```
DATABASE_URL=\"postgresql://$POSTGRESQL_USER:$POSTGRESQL_PASSWORD@db:5432/$DATABASE_NAME?schema=public\"
```

### Optional and advanced configuration

There are additional configuration variables in [install.config.example](install.config.example), such as Craig's PostgreSQL database username and password.

There are even more configuration options located in: [apps/bot/config/_default.js](apps/bot/config/_default.js) and [apps/tasks/config/_default.js](apps/tasks/config/_default.js).

Changing some of these variables from their default values will break Craig, so be careful.

### Suggested self-host configuration changes

#### `install.config`

- `API_HOST`: The default value of `127.0.0.1` means that only the machine running Craig can access the web GUI, which is difficult in a headless environment, such as within a Docker container. Setting the value to `0.0.0.0` will permit any machine that can access the machine's port to access the page, such as those on the local network.
- `API_HOMEPAGE`: This should be changed to the IP address or domain name of the machine running Craig so that download links are functional (e.g., `http://localhost:5029` or `http://192.168.0.10:5029`).
- `RECORDING_RETENTION_DAYS`: Controls how long recordings remain downloadable and how long orphaned recording files are kept. The Docker example uses `3` days to keep disk usage low.

#### `apps/bot/config/_default.js`

- `dexare.craig.rewardTiers`: Self-hosters usually won't care about reward tiers. You can enable maximum rewards for all users by replacing `rewardTiers` with the following:
```ts
rewardTiers: {
   [0]: {
      recordHours: 24,
      downloadExpiryHours: 24 * Number(process.env.RECORDING_RETENTION_DAYS || 3),
      features: ['mix', 'auto', 'drive', 'glowers', 'eccontinuous', 'ecflac', 'mp3'],
      sizeLimitMult: 5
   }
}
```


## 4. Run install script

Go into the main directory.

### If you are installing to a fresh Linux installation

Run the following:

```sh
./install.sh
```

Note that the script will prompt for `sudo` privileges, in order to automatically install dependencies and configure PostgreSQL.

The installation should take a while. Please make note of any errors or warnings. The install generates an output log located in the main directory: [install.log](install.log).

### If you are installing to a Docker container

Ensure Docker is running on the host machine, then run the following:

```sh
docker compose -f docker-compose.dev.yml up --build
```

### Deploying with a pre-built image (recommended for servers)

If you want to run Craig on a server without building from source, you can use the production image that's hosted on the GHCR. See [SELFHOST.DOCKER.md](SELFHOST.DOCKER.md) for the full guide.

## 5. Invite Craig to a server

You can invite Craig to any Discord server by going to the following URL in your browser. Just make sure to replace `CLIENT_ID` in the URL with the actual value of your Discord Bot's client ID.

https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=68176896&scope=bot%20applications.commands

## 6. Try recording

If everything went smoothly up to now, there should be a running instance of Craig on your local machine. Congratulations!

You can try recording and using Craig's slash commands.

## Important information

### Main dashboard

Located at: http://localhost:3000/login


### HTTPS and localhost - can't go to download page

Craig automatically serves the download pages with the `https://` protocol. For example, if you try to go to the download page after recording, the link will be of the form:

https://localhost:5029/rec/RECORDING_ID

Most if not all browsers won't serve this because `localhost` doesn't have a signed certificate for `https://`. You can simply change the protocol to `http://` by removing the `s` and then you will be able to access your recording download:

http://localhost:5029/rec/RECORDING_ID

### Error that Redis package is not signed

When testing with Kubuntu 23.10, the following error stops `sudo apt update` from working, which prematurely exits the install script:

```
E: Failed to fetch https://packages.redis.io/deb/dists/mantic/InRelease  403  Forbidden [IP: 18.173.121.98 443]
E: The repository 'https://packages.redis.io/deb mantic InRelease' is not signed.
```

This occurs because Redis does not have a signature for the Kubuntu 23.10 release (Mantic). 

A workaround is to comment out the first line in `/etc/apt/sources.list.d/redis.list`, i.e.:

```sh
#deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb mantic main
```

To avoid having to continually comment this out every time the install script is ran, you can add the `#` directly in [install.sh](install.sh):

```sh
echo "#deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/redis.list
```

This might need to be done for other distributions as well.

### Restarting Craig after reboot

By default, Craig will not automatically restart if you reboot your computer. To run the application on reboot:

#### Set Permissions for the Install Script
Restrict access to the install.sh script to prevent unauthorized modification, replacing `USERNAME` and `/path/to/craig/`:

```bash
sudo chown USERNAME:USERNAME /path/to/craig/install.sh
sudo chmod 700 /path/to/craig/install.sh
```

#### Create a `visudo` entry:
This allows the `install.sh` script to run without prompting for a password.

```bash
sudo visudo
```

Add the following to the bottom of your `visudo` file, replacing `USERNAME` and `/path/to/craig/`:
```bash
USERNAME ALL=(ALL) NOPASSWD: /path/to/craig/install.sh
```

#### Create a Systemd Service File: 
```bash
sudo nano /etc/systemd/system/craig.service
```

Paste the following content into the file, again replacing `USERNAME` and `/path/to/craig/`:

```
[Unit]
Description=Run Craig install script at startup

[Service]
Type=simple
ExecStart=sudo /path/to/craig/install.sh
User=USERNAME
WorkingDirectory=/path/to/craig/
Restart=on-failure

[Install]
WantedBy=multi-user.target
bash
```

#### Enable the Service: 
This tells systemd to start the service automatically at boot.

```bash
sudo systemctl enable craig.service
```


#### Verification
After enabling the service, reboot your system to verify that Craig starts automatically. You can check the service status using:

```bash
sudo systemctl status craig.service
```

### Monitoring, starting, and stopping Craig

When running with Docker, use `docker compose` commands to manage services.

#### Stream logs per service

```sh
docker compose logs -f bot
docker compose logs -f dashboard
docker compose logs -f download
docker compose logs -f tasks
```

#### Restart a service

```sh
docker compose restart bot
```

#### Stop all services

```sh
docker compose down
```

## Transcribing and summarizing Craig FLAC archives with TASMAS

Craig writes local FLAC exports as `RECORDING_ID.flac.zip` archives after each recording ends. TASMAS cannot process the zip archive directly, so the sidecar in [tasmas](tasmas) stages each archive into its own folder, extracts the per-speaker `.flac` files, builds a `names.json` from Craig's `info.txt`, and runs TASMAS against the extracted FLAC files.

Configure the sidecar in [install.config](install.config), using the `TASMAS transcription sidecar` section from [install.config.example](install.config.example). The sidecar runs as a Docker Compose service and bind-mounts [tasmas](tasmas), so Python code changes do not require rebuilding the image.

Install the host dependencies:

```sh
sudo apt install docker.io docker-compose-plugin
```

Start the watcher:

```sh
docker compose up -d tasmas
```

TASMAS uses `whisper_timestamped` and defaults to Whisper `small`, which is a good fit for an RTX 2060 SUPER with 8 GB VRAM. To pre-download the model into the persistent cache:

```sh
mkdir -p /mnt/media8tb/craig-recordings/tasmas-model-cache
docker run --rm --gpus all \
  --entrypoint python \
  -v /mnt/media8tb/craig-recordings/tasmas-model-cache:/root/.cache \
  kaddaok/tasmas:latest \
  -c "import whisper_timestamped as whisper; whisper.load_model('small', device='cuda')"
```

Run one existing recording:

```sh
docker compose run --rm tasmas python3 /app/tasmas/process_flac_zip.py /mnt/media8tb/craig-recordings/xMOdSpsi9mLY.flac.zip
```

Output is written under `/mnt/media8tb/craig-recordings/tasmas/RECORDING_ID/`, including `transcript.txt` and any summary files. The sidecar also keeps `/mnt/media8tb/craig-recordings/tasmas/recordings.lock.json` so completed recording IDs are skipped on watcher restarts.

TASMAS uses local `whisper_timestamped` for transcription, but its built-in `summarize` mode calls OpenAI's API and asks interactive prompt-file questions, so this automation leaves TASMAS in `semiauto` mode and uses a configurable AI provider chain for unattended summaries. Set `NVIDIA_API_KEY` to use the default NVIDIA summary model:

```txt
mistralai/mistral-large-3-675b-instruct-2512
```

Additional fallback providers can be configured via `SUMMARY_FALLBACK_CHAIN` in `install.config`.
