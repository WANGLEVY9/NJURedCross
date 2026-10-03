import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'reports/**'] },
  js.configs.recommended,
  {
    files: ['server.js', 'lib/**/*.js', 'scripts/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Legacy unused bindings are handled during focused module refactors.
    rules: { 'no-unused-vars': 'off', 'no-useless-assignment': 'off',
      // Security filters deliberately match ASCII control characters.
      'no-control-regex': 'off',
      // Public error boundaries deliberately suppress credential-bearing SDK causes.
      'preserve-caught-error': 'off', 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
];
