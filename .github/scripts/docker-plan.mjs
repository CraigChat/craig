import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const image = 'craig';
const dockerfile = 'Dockerfile';

const watchedPrefixes = ['apps/', 'packages/', 'locale/', 'patches/', 'docker/'];
const watchedFiles = new Set([
  '.dockerignore',
  '.env.example',
  '.github/workflows/build.yml',
  '.github/workflows/docker.yml',
  'Dockerfile',
  'docker.env.example',
  'docker-compose.yml',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'tsdown.config.mjs',
  'turbo.json'
]);

const sanitizeTag = (tag) => tag.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');

function shouldBuildImage(eventName, changedPaths) {
  if (eventName === 'release' || eventName === 'workflow_dispatch') return true;

  return changedPaths.some((path) => watchedFiles.has(path) || watchedPrefixes.some((prefix) => path.startsWith(prefix)));
}

export function createBuildPlan({ eventName, refName = '', releaseTag = '', changedPaths = [] }) {
  const publish = eventName !== 'pull_request';
  const tag = eventName === 'workflow_dispatch' ? 'latest' : eventName === 'release' ? releaseTag : sanitizeTag(refName);
  const hasImage = shouldBuildImage(eventName, changedPaths);

  return {
    image,
    dockerfile,
    hasImage,
    publish,
    tag
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const plan = createBuildPlan({
    eventName: process.env.EVENT_NAME,
    refName: process.env.REF_NAME,
    releaseTag: process.env.RELEASE_TAG,
    changedPaths: process.env.CHANGED_PATHS?.split('\n').filter(Boolean) ?? []
  });
  const outputs = [
    `image=${plan.image}`,
    `dockerfile=${plan.dockerfile}`,
    `has-image=${plan.hasImage}`,
    `publish=${plan.publish}`,
    `tag=${plan.tag}`
  ];
  appendFileSync(process.env.GITHUB_OUTPUT, `${outputs.join('\n')}\n`);
}
