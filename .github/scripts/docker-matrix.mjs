import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const images = [
  ['bot', 'apps/bot/Dockerfile'],
  ['kitchen', 'apps/kitchen/Dockerfile'],
  ['ferret', 'apps/ferret/Dockerfile'],
  ['ennuizel-streamer', 'apps/ennuizel-streamer/Dockerfile'],
  ['dashboard', 'apps/dashboard/Dockerfile'],
  ['tasks', 'apps/tasks/Dockerfile']
];

const all = images.map(([app]) => app);
const rules = [
  ['apps/bot/', ['bot']],
  ['apps/kitchen/', ['kitchen']],
  ['apps/ferret/', ['ferret']],
  ['apps/ennuizel-streamer/', ['ennuizel-streamer']],
  ['apps/dashboard/', ['dashboard']],
  ['apps/tasks/', ['tasks']],
  ['packages/common/', ['bot', 'kitchen', 'ferret', 'ennuizel-streamer', 'dashboard']],
  ['packages/db/', ['bot', 'kitchen', 'ferret', 'dashboard', 'tasks']],
  ['packages/logger/', all],
  ['packages/metrics/', ['bot', 'kitchen', 'ennuizel-streamer']],
  ['packages/types/', ['kitchen', 'ferret', 'ennuizel-streamer', 'dashboard']],
  ['locale/', ['bot', 'ferret', 'dashboard']],
  ['.env.example', ['ferret', 'dashboard']],
  ['patches/', ['ferret']]
];
const rebuildAll = new Set([
  '.dockerignore',
  '.github/workflows/docker.yml',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'tsdown.config.mjs',
  'turbo.json'
]);

const sanitizeTag = (tag) => tag.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');

export function createBuildPlan({ eventName, refName = '', releaseTag = '', changedPaths = [] }) {
  const publish = eventName !== 'pull_request';
  const tag = eventName === 'workflow_dispatch' ? 'latest' : eventName === 'release' ? releaseTag : sanitizeTag(refName);
  const selected = new Set(eventName === 'release' || eventName === 'workflow_dispatch' ? all : []);

  for (const path of changedPaths) {
    if (rebuildAll.has(path)) all.forEach((app) => selected.add(app));
    for (const [prefix, apps] of rules) if (path.startsWith(prefix)) apps.forEach((app) => selected.add(app));
  }

  return {
    matrix: { include: images.filter(([app]) => selected.has(app)).map(([app, dockerfile]) => ({ app, dockerfile })) },
    publish,
    tag
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const plan = createBuildPlan({
    eventName: process.env.EVENT_NAME,
    refName: process.env.REF_NAME,
    releaseTag: process.env.RELEASE_TAG,
    changedPaths: process.env.CHANGED_PATHS?.split('\n').filter(Boolean)
  });
  const outputs = [`matrix=${JSON.stringify(plan.matrix)}`, `has-images=${plan.matrix.include.length > 0}`, `publish=${plan.publish}`, `tag=${plan.tag}`];
  appendFileSync(process.env.GITHUB_OUTPUT, `${outputs.join('\n')}\n`);
}
