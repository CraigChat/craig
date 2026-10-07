import { execa, type Options, parseCommandString } from 'execa';

const activeProcesses = new Set<Promise<unknown> & { kill(): boolean }>();
let acceptingProcesses = true;

export function runCommand<const OptionsType extends Options = Record<never, never>>(command: string, options: OptionsType = {} as OptionsType) {
  if (!acceptingProcesses) throw new Error('Kitchen is shutting down; cannot start a subprocess.');
  const subprocess = execa({
    ...options,
    killDescendants: true,
    forceKillAfterDelay: 3000
  })`${parseCommandString(command)}`;
  activeProcesses.add(subprocess);
  void subprocess.then(
    () => activeProcesses.delete(subprocess),
    () => activeProcesses.delete(subprocess)
  );
  return subprocess;
}

export async function stopProcesses() {
  acceptingProcesses = false;
  const processes = Array.from(activeProcesses);
  for (const subprocess of processes) subprocess.kill();
  await Promise.allSettled(processes);
}
