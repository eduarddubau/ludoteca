import { defineConfig, type UserConfig } from 'tsdown'

const shared: UserConfig = {
  outDir: 'dist',
  platform: 'node',
  target: 'node24'
}

export default defineConfig([
  {
    ...shared,
    entry: { 'main/index': 'src/main/index.ts' },
    format: 'esm',
    deps: {
      // better-sqlite3 is a native addon and cannot be bundled.
      neverBundle: ['electron', 'better-sqlite3'],
      // The packaged app ships dist/ alone, so workspace code has to be inside it.
      alwaysBundle: [/^@ludoteca\//],
      onlyBundle: ['papaparse']
    }
  },
  // Sandboxed preloads cannot load ES modules.
  {
    ...shared,
    entry: { 'preload/index': 'src/preload/index.ts' },
    format: 'cjs',
    checks: { legacyCjs: false },
    deps: { neverBundle: ['electron'], onlyBundle: [] }
  }
])
