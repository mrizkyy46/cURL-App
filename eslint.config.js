import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['artifacts/**', '.playwright-cli/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { globals: globals.node },
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }] },
  },
  { files: ['src/public/js/*.js'], languageOptions: { globals: globals.browser } },
  // The parser and proxy deliberately reject control characters in input.
  { files: ['src/public/js/parser.js', 'server.js'], rules: { 'no-control-regex': 'off' } },
  // Keep the existing shell-tokenizer regular expressions untouched by styling work.
  { files: ['src/public/js/parser.js'], rules: { 'no-useless-escape': 'off' } },
];
