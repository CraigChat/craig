import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBuildPlan } from './docker-matrix.mjs';

const names = (plan) => plan.matrix.include.map(({ app }) => app);

test('selects only the directly changed app', () => {
  assert.deepEqual(names(createBuildPlan({ eventName: 'pull_request', changedPaths: ['apps/tasks/src/index.ts'] })), ['tasks']);
});

test('selects consumers of the database package', () => {
  assert.deepEqual(names(createBuildPlan({ eventName: 'pull_request', changedPaths: ['packages/db/src/index.ts'] })), [
    'bot',
    'kitchen',
    'ferret',
    'dashboard',
    'tasks'
  ]);
});

test('selects translation consumers for a locale update', () => {
  assert.deepEqual(names(createBuildPlan({ eventName: 'pull_request', changedPaths: ['locale/en/ferret.json'] })), [
    'bot',
    'ferret',
    'dashboard'
  ]);
});

test('selects every image for a root lockfile update', () => {
  assert.equal(names(createBuildPlan({ eventName: 'pull_request', changedPaths: ['pnpm-lock.yaml'] })).length, 6);
});

test('selects Svelte images for a root environment example update', () => {
  assert.deepEqual(names(createBuildPlan({ eventName: 'pull_request', changedPaths: ['.env.example'] })), ['ferret', 'dashboard']);
});

test('selects Ferret for a patched dependency update', () => {
  assert.deepEqual(names(createBuildPlan({ eventName: 'pull_request', changedPaths: ['patches/svelte-awesome-color-picker@4.0.2.patch'] })), ['ferret']);
});

test('selects no images for unrelated documentation', () => {
  assert.deepEqual(names(createBuildPlan({ eventName: 'pull_request', changedPaths: ['README.md'] })), []);
});

test('publishes affected push images with a sanitized branch tag', () => {
  const plan = createBuildPlan({
    eventName: 'push',
    refName: 'feature/docker-ci',
    changedPaths: ['apps/bot/src/index.ts']
  });
  assert.equal(plan.publish, true);
  assert.equal(plan.tag, 'feature-docker-ci');
  assert.deepEqual(names(plan), ['bot']);
});

test('publishes every released image with the exact release tag', () => {
  const plan = createBuildPlan({ eventName: 'release', releaseTag: 'v1.2.3' });
  assert.equal(plan.publish, true);
  assert.equal(plan.tag, 'v1.2.3');
  assert.equal(names(plan).length, 6);
});

test('publishes every manually triggered image as latest', () => {
  const plan = createBuildPlan({ eventName: 'workflow_dispatch' });
  assert.equal(plan.publish, true);
  assert.equal(plan.tag, 'latest');
  assert.equal(names(plan).length, 6);
});
