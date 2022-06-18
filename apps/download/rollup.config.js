import typescript from '@rollup/plugin-typescript';
import { terser } from 'rollup-plugin-terser';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import json from '@rollup/plugin-json';
import buble from '@rollup/plugin-buble';
import postcss from 'rollup-plugin-postcss';
import purgecss from '@fullhuman/postcss-purgecss';
import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';
import commonjs from '@rollup/plugin-commonjs';
import injectProcessEnv from 'rollup-plugin-inject-process-env';
import alias from '@rollup/plugin-alias';
import { execSync } from 'child_process';
import pkg from './package.json';
import dotenv from 'dotenv';
import path from 'path';
import { readdirSync, readFileSync } from 'fs';
dotenv.config();

let revision = '<unknown>';
try {
  revision = execSync('git rev-parse HEAD', { cwd: __dirname }).toString().trim();
} catch (e) {}

// Really annoying locale implementation
const localePath = path.join(__dirname, '../../locale');
const locales = readdirSync(localePath)
  .filter((f) => !f.includes('.'))
  .reduce(
    (pl, l) => ({
      ...pl,
      [l]: readdirSync(path.join(localePath, l)).reduce(
        (pj, j) => ({
          ...pj,
          [j.replace('.json', '')]: JSON.parse(readFileSync(path.join(localePath, l, j), { encoding: 'utf-8' }))
        }),
        {}
      )
    }),
    {}
  );

export default ({ watch }) => [
  {
    // Page Build
    input: 'page/src/index.tsx',
    output: {
      file: 'dist/page/rec.js',
      format: 'iife',
      compact: !watch,
      sourcemap: true
    },
    plugins: [
      postcss({
        plugins: [
          tailwindcss('./tailwind.config.js'),
          !watch && autoprefixer(),
          !watch &&
            purgecss({
              content: ['./page/src/**/*.tsx', './page/src/**/*.ts', './page/src/**/*.sass'],
              safelist: {
                standard: ['enter', 'leave', 'ul'],
                deep: [],
                greedy: [/^tippy-/],
                keyframes: [],
                variables: []
              },
              blocklist: ['light-theme', 'transparent-theme'],
              extractors: [
                {
                  extractor: (content) => content.match(/[A-Za-z0-9_-][A-Za-z0-9_:/-]*/g) || [],
                  extensions: ['tsx']
                }
              ]
            })
        ],
        extract: true,
        minimize: !watch
      }),
      json({ compact: true }),
      commonjs(),
      typescript({
        tsconfig: './page/tsconfig.json'
      }),
      injectProcessEnv({
        NODE_ENV: !watch ? 'production' : 'development',
        GIT_REVISION: revision,
        VERSION: pkg.version,
        ENNUIZEL_BASE: process.env.ENNUIZEL_BASE,
        SENTRY_DSN: process.env.SENTRY_DSN,
        SENTRY_SAMPLE_RATE: process.env.SENTRY_SAMPLE_RATE,
        LOCALES: locales
      }),
      alias({
        entries: [
          { find: 'react', replacement: 'preact/compat' },
          { find: 'react-dom/test-utils', replacement: 'preact/test-utils' },
          { find: 'react-dom', replacement: 'preact/compat' },
          { find: 'react/jsx-runtime', replacement: 'preact/jsx-runtime' }
        ]
      }),
      nodeResolve({
        module: true,
        browser: true
      }),
      buble({
        jsx: 'h',
        objectAssign: 'Object.assign',
        transforms: {
          generator: false,
          classes: false,
          asyncAwait: false,
          forOf: false
        }
      }),
      !watch && terser()
    ]
  }
];
