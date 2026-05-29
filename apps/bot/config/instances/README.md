# Bot instances

Place instance override files here as `*.env` files. The file name is the instance name. The instance .env will override any variables from the repo's .env file and the bot's .env file.

Example file `craig2.env`:

```env
# Set the PM2 process name with this variable
PM2_PROCESS_NAME=Craig 2
BOT_TOKEN=...
BOT_APPLICATION_ID=...
```

Commands:

```bash
pnpm bot-instance start craig2 # Start the PM2 instance
pnpm bot-instance reload craig2 # Reload the PM2 instance
pnpm bot-instance sync craig2 # Sync commands
```
