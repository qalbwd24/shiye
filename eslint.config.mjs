import globals from 'globals';
export default [
  {
    ignores: [
      'node_modules/**',
      'data/**',
      'var/**',
      'build/**',
      'public/vendor/**',
      'resources/**',
      'docs/archive/**',
      'tools/manual/archive/**',
      'tests/ui-test-data/**',
    ],
  },
  {
    files: ['**/*.mjs', 'public/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      'no-unreachable': 'error',
      'no-constant-condition': 'error',
      eqeqeq: 'error',
    },
  },
];
