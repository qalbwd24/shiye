import globals from 'globals';
export default [
  {
    ignores: [
      'node_modules/**',
      'data/**',
      'var/**',
      'tmp/**',
      'outputs/**',
      'build/**',
      'public/vendor/**',
      'resources/**',
      'previews/telegram-chat/vendor/**',
      'docs/archive/**',
      'tools/manual/archive/**',
      'tests/ui-test-data/**',
    ],
  },
  {
    files: [
      '**/*.mjs',
      'public/**/*.js',
      'android/app/src/main/assets/editor.js',
      'android/telegram-adapter/*.js',
      'previews/telegram-chat/shiye-*.js',
      'previews/telegram-chat/verify-ui.js',
      'previews/telegram-chat/verify-image.js',
    ],
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
