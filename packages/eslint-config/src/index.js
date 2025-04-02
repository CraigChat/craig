import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import json from 'eslint-plugin-json';
import prettierRules from 'eslint-plugin-prettier/recommended';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import svelte from 'eslint-plugin-svelte';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';
import svelteParser from 'svelte-eslint-parser';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // JS/TS
  js.configs.recommended,
  tseslint.configs.recommended,
  importPlugin.flatConfigs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [importPlugin.flatConfigs.typescript]
  },
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
      'import/first': 'warn',
      'import/newline-after-import': 'warn',
      'import/no-duplicates': 'warn',
      'import/order': 0,
      'import/default': 0,
      'import/named': 0,
      'import/namespace': 0,
      'import/no-named-as-default': 0,
      'import/no-named-as-default-member': 0,
      'import/no-unresolved': 0,
      'import/export': 0,
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

  // JSON
  {
    files: ['**/*.json'],
    ...json.configs['recommended-with-comments']
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
        parser: tseslint.parser,
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
