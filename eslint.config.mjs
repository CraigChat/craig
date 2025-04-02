import config from 'eslint-config-craig';

export default [
  ...config,
  {
    ignores: [
      'node_modules/',
      'dist/',
      'rec/',
      'downloads/',
      'build/',
      '.svelte-kit/',
      'pnpm-lock.yaml',
      'package/',
      'vite.config.js.timestamp-*',
      'vite.config.ts.timestamp-*'
    ]
  }
];
