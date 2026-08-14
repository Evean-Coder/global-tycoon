'use strict';

const nodeGlobals = {
  console: 'readonly',
  process: 'readonly',
  require: 'readonly',
  module: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  queueMicrotask: 'readonly',
};

const browserGlobals = Object.assign({}, nodeGlobals, {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  location: 'readonly',
  history: 'readonly',
  io: 'readonly',
  Blob: 'readonly',
  URL: 'readonly',
  fetch: 'readonly',
  confirm: 'readonly',
});

module.exports = [
  { ignores: ['node_modules/**', 'records/**', 'design/**', 'scripts/ui-probe.js'] },
  {
    files: ['server.js', 'src/**/*.js', 'scripts/**/*.js', 'test/**/*.js', 'e2e/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: nodeGlobals },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-redeclare': 'error',
      'no-constant-condition': 'error',
      'no-dupe-keys': 'error',
    },
  },
  {
    files: ['e2e/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: Object.assign({}, nodeGlobals, { document: 'readonly', window: 'readonly', navigator: 'readonly' }) },
    rules: { 'no-undef': 'error', 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  {
    files: ['public/client.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: browserGlobals },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-redeclare': 'error',
      'no-constant-condition': 'error',
      'no-dupe-keys': 'error',
    },
  },
];
