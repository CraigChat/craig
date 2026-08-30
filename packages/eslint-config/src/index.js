import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
// import { importX } from 'eslint-plugin-import-x';
import prettierRules from 'eslint-plugin-prettier/recommended';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import svelte from 'eslint-plugin-svelte';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';
import svelteParser from 'svelte-eslint-parser';
import ts from 'typescript-eslint';

export default defineConfig(
  // JS/TS
  js.configs.recommended,
  ...ts.configs.recommended,
  // importX.flatConfigs.recommended,
  // importX.flatConfigs.typescript,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.es2025,
        ...globals.node
      }
    },
    plugins: {
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 0,
      '@typescript-eslint/triple-slash-reference': 0,
      '@typescript-eslint/no-non-null-assertion': 0,
      '@typescript-eslint/no-empty-function': 0,
      '@typescript-eslint/ban-ts-comment': 0,
      '@typescript-eslint/no-var-requires': 0,
      '@typescript-eslint/no-unused-vars': [
        1,
        {
          caughtErrors: 'none',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_'
        }
      ],
      // 'import-x/first': 'warn',
      // 'import-x/newline-after-import': 'warn',
      // 'import-x/no-duplicates': 'warn',
      // 'import-x/order': 0,
      // 'import-x/default': 0,
      // 'import-x/named': 0,
      // 'import-x/namespace': 0,
      // 'import-x/no-named-as-default': 0,
      // 'import-x/no-named-as-default-member': 0,
      // 'import-x/no-unresolved': 0,
      // 'import-x/export': 0,
      'no-async-promise-executor': 0,
      'prettier/prettier': 'warn',
      'no-cond-assign': [2, 'except-parens'],
      'no-unused-vars': 0,
      'no-empty': [
        'error',
        {
          allowEmptyCatch: true
        }
      ],
      'prefer-const': [
        'warn',
        {
          destructuring: 'all'
        }
      ],
      'spaced-comment': 'warn',
      'simple-import-sort/exports': 'warn',
      'simple-import-sort/imports': 'warn'
    }
  },
  {
    files: ['**/*.d.ts'],
    rules: { 'spaced-comment': 0 }
  },

  // CJS
  {
    files: ['**/*.{cjs,cts}'],
    rules: {
      '@typescript-eslint/no-require-imports': 0
    }
  },

  // Svelte
  ...svelte.configs['flat/prettier'],
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    ignores: ['eslint.config.js', 'svelte.config.js'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: ts.parser,
        extraFileExtensions: ['.svelte']
      },
      globals: {
        ...globals.browser
      }
    },
    rules: {
      'prefer-const': 0
    }
  },

  // Prettier (sorted last)
  prettierRules
);
