import 'dotenv/config';

import { PrismaClient } from '@prisma/client';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import readline from 'node:readline';

const prisma = new PrismaClient();
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
const HOUR = 1000 * 60 * 60;

function promiseQuestion(query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

(async () => {
  console.log('Connecting to database...');
  await prisma.$connect();

  const files = await readdir('./rec');
  const infos = await Promise.all(
    files
      .filter((f) => f.endsWith('.ogg.info'))
      .map((f) => readFile(`./rec/${f}`, { encoding: 'utf-8' }).then((j) => ({ id: f.split('.')[0], info: JSON.parse(j) as any })))
  );

  console.log(`Found ${infos.length} recordings with info.\n`);

  const answer = await promiseQuestion('How far should recordings be delayed? [d = day, m = month, h = hour] ');
  if (!/^\d+[dmh]$/.test(answer)) return console.log(' - Invalid answer.');

  let time = parseInt(answer) * HOUR;
  if (answer.endsWith('d')) time = parseInt(answer.slice(0, -1)) * HOUR * 24;
  else if (answer.endsWith('m')) time = parseInt(answer.slice(0, -1)) * HOUR * 24 * 30;
  else if (answer.endsWith('h')) time = parseInt(answer.slice(0, -1)) * HOUR;

  if (time <= 0 || isNaN(time) || !isFinite(time)) return console.log(' - Invalid answer.');

  const newExpiryTime = Date.now() + time;
  const delayedInfos = infos.filter((i) => Date.parse(i.info.startTime) + 1000 * 60 * 60 * (i.info.expiresAfter || 24) < newExpiryTime);

  console.log(`\n{ ${delayedInfos.length} } recordings will have their expiry changed.`);
  const confirm = await promiseQuestion('Are you sure you want to do this? (y/N) ');
  if (confirm.toLowerCase() !== 'y') return console.log(' - Cancelled.');

  for (const rec of delayedInfos) {
    console.log(`= Writing to ${rec.id}`);
    const newExpiresAfter = Math.ceil((newExpiryTime - Date.parse(rec.info.startTime)) / HOUR);
    await writeFile(
      `./rec/${rec.id}.ogg.info`,
      JSON.stringify({ ...rec.info, expiresAfter: newExpiresAfter, _previousExpiresAfter: rec.info.expiresAfter })
    );

    await prisma.recording.update({
      where: { id: rec.id },
      data: { expiresAt: new Date(Date.parse(rec.info.startTime) + newExpiresAfter * HOUR) }
    });
  }

  console.log('\n ok.');
})().then(() => rl.close());
