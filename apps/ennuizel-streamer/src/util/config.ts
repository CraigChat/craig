import './env.js';

import { fileURLToPath } from 'node:url';

import { DEV_MODE } from './index.js';

export const REC_DIRECTORY = fileURLToPath(new URL(process.env.REC_DIRECTORY || DEV_MODE ? '../../../../rec' : '../../../rec', import.meta.url));

export const PROC_NICENESS = process.env.PROC_NICENESS ? parseInt(process.env.PROC_NICENESS, 10) : 10;
export const PROC_TASKSET_CPU_MAP = process.env.PROC_TASKSET_CPU_MAP ?? null;
export const PROC_IONICE = process.env.PROC_IONICE ? parseInt(process.env.PROC_IONICE, 10) : 3;
export const PROC_CHRT_IDLE = process.env.PROC_CHRT_IDLE === 'true';

export const HOST = process.env.HOST || 'localhost';
export const PORT = process.env.PORT ? parseInt(process.env.PORT) : 9001;
export const PROXY_HEADER = process.env.PROXY_HEADER ?? null;
