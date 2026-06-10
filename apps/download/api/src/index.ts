import dotenv from 'dotenv';
import path from 'path';

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

let dotenvPath = path.join(process.cwd(), '.env');
if (path.parse(process.cwd()).name === 'dist') {
  dotenvPath = path.join(process.cwd(), '..', '.env');
}

dotenv.config({ path: dotenvPath });

// eslint-disable-next-line import/first
import { start, stop } from './api';

start();

process.once('SIGTERM', stop);
process.once('SIGINT', stop);
