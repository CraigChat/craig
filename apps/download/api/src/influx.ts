import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { captureException, withScope } from '@sentry/node';
import { CronJob } from 'cron';
import { hostname } from 'os';

export const client = process.env.INFLUX_URL ? new InfluxDB({ url: process.env.INFLUX_URL, token: process.env.INFLUX_TOKEN }) : null;

export const cron = new CronJob('*/5 * * * *', collect, null, false, 'America/New_York');

export let activeRecordings: string[] = [];
export let requestsRecieved = 0;
export let readysRecieved = 0;
export let cooksStarted = 0;
export const formatsCooked = new Map<string, number>();

export function onRequest(recordingID: string, isReady = false) {
  if (!activeRecordings.includes(recordingID)) activeRecordings.push(recordingID);

  if (isReady) readysRecieved++;
  else requestsRecieved++;
}

export function onCookRun(recordingID: string, format: string) {
  let cookCount = formatsCooked.get(format) || 0;

  cookCount++;
  cooksStarted++;

  if (!activeRecordings.includes(recordingID)) activeRecordings.push(recordingID);

  formatsCooked.set(format, cookCount);
}

async function collect(timestamp = new Date()) {
  if (!process.env.INFLUX_URL || !process.env.INFLUX_TOKEN) return;

  const writeApi = client.getWriteApi(process.env.INFLUX_ORG, process.env.INFLUX_BUCKET, 's');
  const points = [
    new Point('craighorse_stats')
      .tag('server', process.env.SERVER_NAME || hostname())
      .intField('recieved', requestsRecieved)
      .intField('readysRecieved', readysRecieved)
      .intField('recievedUnique', activeRecordings.length)
      .intField('cooksStarted', cooksStarted)
      .timestamp(timestamp || cron.lastDate())
  ];

  // Insert format counts
  formatsCooked.forEach((count, name) =>
    points.push(
      new Point('craighorse_format_usage')
        .tag('server', process.env.SERVER_NAME || hostname())
        .tag('format', name)
        .intField('cooked', count)
        .timestamp(timestamp || cron.lastDate())
    )
  );

  // Send to influx
  try {
    writeApi.writePoints(points);
    await writeApi.close();
  } catch (e) {
    withScope((scope) => {
      scope.clear();
      scope.setExtra('date', timestamp || cron.lastDate());
      captureException(e);
    });
    console.error('Error sending stats to Influx.', e);
  }

  // Flush data for next cron run
  activeRecordings = [];
  requestsRecieved = 0;
  readysRecieved = 0;
  cooksStarted = 0;
  formatsCooked.clear();
}
