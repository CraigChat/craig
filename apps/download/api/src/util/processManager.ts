import { captureException, withScope } from '@sentry/node';
import { ChildProcessWithoutNullStreams } from 'child_process';
import { CronJob } from 'cron';

const processes = new Map<number, { process: ChildProcessWithoutNullStreams; onClose: () => any; started: number }>();
const lastActivity = new Map<number, number>();

export const cron = new CronJob('*/5 * * * *', clean, null, false, 'America/New_York');

function killProcessTree(p: ChildProcessWithoutNullStreams) {
  if (p.killed || !p.pid) return true;
  try {
    const result = process.kill(p.pid);
    return result;
  } catch (e) {
    if ((e as Error).message.startsWith('kill ESRCH')) return true;
    return false;
  }
}

export function registerProcess(p: ChildProcessWithoutNullStreams, onClose: () => any) {
  const started = Date.now();
  processes.set(p.pid, { process: p, onClose, started });
  p.stdout.on('data', () => lastActivity.set(p.pid, Date.now()));
  p.stdout.once('end', () => {
    console.log(`Process ${p.pid} stdout stream ended (started ${Date.now() - started}ms ago)`);
    removeProcess(p.pid);
  });
  p.stdout.once('error', (e) => {
    console.error(`Process ${p.pid} stdout stream errored (started ${Date.now() - started}ms ago)`, e);
    removeProcess(p.pid);
  });

  p.on('exit', (code) => {
    console.log(`Process ${p.pid} exited with code ${code} (started ${Date.now() - started}ms ago)`);
  });
  p.on('disconnect', () => {
    console.log(`Process ${p.pid} disconnected (started ${Date.now() - started}ms ago)`);
  });
}

export function removeProcess(pid: number) {
  if (processes.has(pid)) {
    const { process, onClose } = processes.get(pid)!;
    processes.delete(pid);
    const success = killProcessTree(process);
    console.log(`Process ${process.pid} ${success ? 'successfully killed' : 'killed unsuccessfully'}`);
    onClose();
  }
}

async function clean(timestamp = new Date()) {
  try {
    for (const { process, started } of processes.values()) {
      if (Date.now() - lastActivity.get(process.pid) > 360000) {
        console.log(`Process ${process.pid} has been inactive for 5 minutes... (started ${Date.now() - started}ms ago)`);
        removeProcess(process.pid);
      }
    }
  } catch (e) {
    withScope((scope) => {
      scope.clear();
      scope.setExtra('date', timestamp || cron.lastDate());
      captureException(e);
    });
    console.error('Error cleaning processes.', e);
  }
}
