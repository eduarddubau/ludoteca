import { defineConfig } from 'tsup'

// CommonJS because Electron's main process still loads .cjs most predictably, and
// better-sqlite3 is a native addon that cannot be bundled.
export default defineConfig({
  entry: { 'main/index': 'src/main/index.ts', 'preload/index': 'src/preload/index.ts' },
  outDir: 'dist',
  format: ['cjs'],
  outExtension: () => ({ js: '.cjs' }),
  target: 'node22',
  platform: 'node',
  external: ['electron', 'better-sqlite3'],
  // Workspace source is bundled in: core is ESM-only and this output is CJS.
  noExternal: [/^@ludoteca\//],
  clean: true
})
