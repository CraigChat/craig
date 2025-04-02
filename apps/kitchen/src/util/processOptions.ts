import { execaCommand } from 'execa';

import { PROC_CHRT_IDLE, PROC_IONICE, PROC_NICENESS, PROC_TASKSET_CPU_MAP } from './config.js';
import logger from './logger.js';

let niceness: number | null = PROC_NICENESS;
let cpuMap: string | null = PROC_TASKSET_CPU_MAP;
let ioniceClass: number | null = PROC_IONICE;
let useChrt = PROC_CHRT_IDLE;

export async function testProcessOptions() {
  const niceProcess = await execaCommand(`nice -n${niceness} echo`)
    .then(() => null)
    .catch((e) => e);
  if (niceProcess) {
    logger.warn(`Invalid niceness value when testing with '${niceProcess.command}', removing variable`, niceProcess.stderr);
    niceness = null;
  }

  const tasksetProcess = await execaCommand(`taskset -c ${cpuMap} echo`)
    .then(() => null)
    .catch((e) => e);
  if (tasksetProcess) {
    logger.warn(`Invalid taskset cpu list value when testing with '${tasksetProcess.command}', removing variable`, tasksetProcess.stderr);
    cpuMap = null;
  }

  const ioniceProcess = await execaCommand(`ionice -c${ioniceClass} echo`)
    .then(() => null)
    .catch((e) => e);
  if (ioniceProcess) {
    logger.warn(`Invalid ionice class value when testing with '${ioniceProcess.command}', removing variable`, ioniceProcess.stderr);
    ioniceClass = null;
  }

  if (useChrt) {
    const chrtProcess = await execaCommand('chrt -i 0 echo')
      .then(() => null)
      .catch((e) => e);
    if (chrtProcess) {
      logger.warn(`chrt failed testing with '${chrtProcess.command}', disabling`, chrtProcess.stderr);
      useChrt = false;
    }
  }
}

export function procOpts({
  nice = niceness,
  cpuList = cpuMap,
  niceClass = ioniceClass,
  chrt = useChrt
}: {
  nice?: number | null;
  cpuList?: string | null;
  niceClass?: number | null;
  chrt?: boolean;
} = {}) {
  const commands = [
    nice && nice !== 0 ? `nice -n${nice}` : null,
    cpuList ? `taskset -c ${cpuList}` : null,
    niceClass ? `ionice -c${niceClass}` : null,
    chrt ? 'chrt -i 0' : null
  ];

  return commands.filter((cmd) => cmd !== null).join(' ');
}

export async function testTaskset(cpuList: string) {
  const result = await execaCommand(`taskset -c ${cpuList} echo`)
    .then(() => null)
    .catch((e) => e);
  return !result;
}
