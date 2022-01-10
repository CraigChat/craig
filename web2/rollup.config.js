import typescript from '@rollup/plugin-typescript';
import { terser } from 'rollup-plugin-terser';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import buble from '@rollup/plugin-buble';
import postcss from 'rollup-plugin-postcss';
import purgecss from '@fullhuman/postcss-purgecss';
import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';
import commonjs from '@rollup/plugin-commonjs';
import injectProcessEnv from 'rollup-plugin-inject-process-env';
import alias from '@rollup/plugin-alias';

export default ({ watch }) => [
  {
    // Page Build
    input: 'page/src/index.tsx',
    output: {
      file: 'dist/page/rec.js',
      format: 'iife',
      compact: !watch,
      sourcemap: !watch
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
                standard: ['enter', 'leave', 'min-w-1/2', 'w-5/6', 'md:min-w-2/5'],
                deep: [],
                greedy: [/^tippy-/],
                keyframes: [],
                variables: []
              },
              blocklist: ['light-theme', 'transparent-theme'],
              extractors: [
                {
                  extractor: (content) => content.match(/[A-Za-z0-9_-][A-Za-z0-9_:-]*/g) || [],
                  extensions: ['tsx']
                }
              ]
            })
        ],
        extract: true,
        minimize: !watch
      }),
      commonjs(),
      typescript({
        outDir: 'dist/page',
        module: 'esnext',
        jsx: 'preserve',
        jsxFactory: 'h',
        jsxFragmentFactory: 'Fragment',
        moduleResolution: 'node',
        resolveJsonModule: true,
        paths: {
          react: ['./node_modules/preact/compat/'],
          'react-dom': ['./node_modules/preact/compat/']
        }
      }),
      injectProcessEnv({
        NODE_ENV: !watch ? 'production' : 'development'
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
          asyncAwait: false
        }
      }),
      !watch && terser()
    ]
  }
];
