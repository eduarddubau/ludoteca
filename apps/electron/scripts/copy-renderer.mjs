// The built UI lives in a sibling workspace, which a packaged app cannot reach. It is
// copied under dist/ so the bundle is self-contained and the protocol handler resolves
// against its own directory rather than a path that only exists in this checkout.
import { cp, rm, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, '../../../packages/ui/dist')
const target = join(here, '../dist/renderer')

try {
  await access(source)
} catch {
  console.error(`No built UI at ${source} — run "npm run build" at the repo root first.`)
  process.exit(1)
}

await rm(target, { recursive: true, force: true })
await cp(source, target, { recursive: true })
console.log(`Copied UI to ${target}`)
