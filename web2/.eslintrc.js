module.exports = {
  env: {
    es2020: true,
    commonjs: true,
    es6: true,
    node: true
  },
  extends: ['eslint:recommended', 'plugin:prettier/recommended'],
  globals: {},
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 6,
    sourceType: 'module'
  },
  plugins: ['@typescript-eslint'],
  rules: {
    'prettier/prettier': 'warn',
    'no-cond-assign': [2, 'except-parens'],
    'no-unused-vars': 0,
    '@typescript-eslint/no-unused-vars': 1,
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
    'spaced-comment': 'warn'
  },
  overrides: [
    {
      files: ['page/**/*'],
      extends: ['preact', 'eslint:recommended', 'plugin:prettier/recommended'],
      parser: '@typescript-eslint/parser',
      env: {
        browser: true
      },
      rules: {
        'prettier/prettier': 'warn',
        'react/jsx-no-bind': 0,
        'no-cond-assign': [2, 'except-parens'],
        'no-unused-vars': 0,
        '@typescript-eslint/no-unused-vars': 1,
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
        'jest/no-deprecated-functions': 0
      }
    }
  ]
};
