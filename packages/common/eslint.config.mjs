import config from '../../eslint.config.mjs';

export default [
  ...config,
  {
    ignores: ['dist/**']
  }
];
