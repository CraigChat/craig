module.exports = {
  extends: ['../../.eslintrc.js'],
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
