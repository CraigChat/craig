import { BotCTLBot } from './bot.js';

const bot = new BotCTLBot();

bot.start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

process.once('SIGINT', async () => {
  await bot.stop();
  process.exit(0);
});

process.once('SIGTERM', async () => {
  await bot.stop();
  process.exit(0);
});
