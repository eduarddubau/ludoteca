import js from '@eslint/js'
import ts from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

// The boundary this repo is built around: `core` and `ui` run unchanged inside
// Electron, Tauri and (later) Capacitor, so neither may reach for a shell API.
// Everything platform-specific arrives through the injected Platform.
const shellFree = {
  files: ['packages/core/**/*.ts', 'packages/ui/**/*.{ts,vue}'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [
        { name: 'electron', message: 'core/ui must stay shell-agnostic — use the injected Platform.' },
        { name: 'better-sqlite3', message: 'Reach the database through Platform.db.' }
      ],
      patterns: [
        { group: ['node:*', 'fs', 'path', 'crypto', 'child_process'], message: 'No Node built-ins: this code also runs in a mobile webview.' },
        { group: ['@tauri-apps/*'], message: 'core/ui must stay shell-agnostic — use the injected Platform.' }
      ]
    }]
  }
}

export default ts.config(
  { ignores: ['**/dist/**', '**/out/**', '**/node_modules/**', 'spikes/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/recommended'],
  // TypeScript already resolves globals; no-undef only produces false positives here.
  { files: ['**/*.ts', '**/*.vue'], rules: { 'no-undef': 'off' } },
  // Build scripts are plain Node ESM, outside the shell boundary the rest of this
  // config enforces.
  {
    files: ['**/scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly' }
    }
  },
  {
    files: ['**/*.vue'],
    languageOptions: { parser: vueParser, parserOptions: { parser: ts.parser } }
  },
  shellFree
)
