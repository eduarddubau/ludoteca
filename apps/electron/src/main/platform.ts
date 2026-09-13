import { app, BrowserWindow, net, safeStorage, session } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import {
  MIGRATIONS, SCHEMA, SCHEMA_VERSION, TABLES,
  type Cookie, type HttpRequest, type HttpResponse
} from '@ludoteca/core'

export interface SerializedPattern {
  source: string
  flags: string
}

// Deliberately not 'persist:' — Electron would write the session cookie jar to disk
// unencrypted, next to a UI that promises credentials live in the OS keychain. The
// durable copy is what a connector puts in `secrets`; this partition is scratch.
export const STORE_PARTITION = 'stores'

// Opened on first use, not at import: app paths are only meaningful once Electron owns
// the process, and a failure here should surface at a call site rather than at load.
let db: Database.Database | undefined

// Deliberately not app.getPath('userData'), which resolves per-shell: this literal
// folder is what lets the Tauri build open the very same database.
export function sharedDataDir(): string {
  const dir = join(app.getPath('appData'), 'ludoteca')
  mkdirSync(dir, { recursive: true })
  return dir
}

function getDb(): Database.Database {
  if (!db) {
    db = new Database(join(sharedDataDir(), 'ludoteca.db'))
    // WAL lets both shells read at once with a single writer.
    db.pragma('journal_mode = WAL')

    const existing = Number((db.pragma('user_version', { simple: true }) as number) ?? 0)
    db.exec(SCHEMA)
    addMissingColumns(db)
    for (const migration of MIGRATIONS.filter((m) => m.version > existing && existing > 0)) {
      db.exec(migration.sql)
    }
    db.pragma(`user_version = ${SCHEMA_VERSION}`)
  }
  return db
}

// Secrets stay per-shell: safeStorage and Tauri's keyring share no format.
interface ColumnInfo {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
}

/**
 * CREATE TABLE IF NOT EXISTS never alters an existing table, so a database written by an
 * older build is missing every column added since. SCHEMA is applied to a throwaway
 * in-memory database and the live tables are reconciled against it, which keeps this
 * correct without anyone having to remember to write an additive migration.
 */
function addMissingColumns(target: Database.Database): void {
  const reference = new Database(':memory:')
  try {
    reference.exec(SCHEMA)
    for (const table of TABLES) {
      const want = reference.pragma(`table_info(${table})`) as ColumnInfo[]
      const have = new Set((target.pragma(`table_info(${table})`) as ColumnInfo[]).map((c) => c.name))

      for (const column of want.filter((c) => !have.has(c.name))) {
        // SQLite requires a default on any NOT NULL column added to an existing table.
        const notNull = column.notnull && column.dflt_value !== null ? ' NOT NULL' : ''
        const defaultTo = column.dflt_value !== null ? ` DEFAULT ${column.dflt_value}` : ''
        target.exec(`ALTER TABLE ${table} ADD COLUMN ${column.name} ${column.type}${notNull}${defaultTo}`)
      }
    }
  } finally {
    reference.close()
  }
}

function secretsPath(): string {
  return join(sharedDataDir(), 'secrets.electron.json')
}

/**
 * Hosts the store's own login page and resolves at the first navigation matching the
 * store's fixed redirect. The redirect URI belongs to the official launcher client and
 * cannot be changed, which is why a loopback callback is no use here.
 */
/**
 * Both windows that render a store's own pages. Spelled out rather than left to
 * defaults, and shared so tightening one cannot silently miss the other. No preload:
 * nothing of ours is reachable from a page we do not control.
 */
const UNTRUSTED_PREFS = {
  partition: STORE_PARTITION,
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webSecurity: true
} as const

export async function authenticate(
  url: string,
  pattern: SerializedPattern,
  title?: string,
  timeoutMs?: number
): Promise<{ redirectUrl: string; cookies: Cookie[] }> {
  const match = new RegExp(pattern.source, pattern.flags)
  requireHttps(url, 'A sign-in page')

  const authWindow = new BrowserWindow({
    width: 980,
    height: 760,
    title: title ?? 'Sign in',
    autoHideMenuBar: true,
    webPreferences: { ...UNTRUSTED_PREFS }
  })

  // Popups opened by the store page. Tracked so they close with the sign-in rather than
  // outliving it as loose windows rendering a third party, which on Linux would also
  // keep the app from quitting.
  const popups = new Set<BrowserWindow>()

  return new Promise((resolve, reject) => {
    let settled = false

    const closeAll = (): void => {
      for (const popup of popups) if (!popup.isDestroyed()) popup.destroy()
      popups.clear()
      if (!authWindow.isDestroyed()) authWindow.destroy()
    }

    const timer = timeoutMs
      ? setTimeout(() => {
          if (settled) return
          settled = true
          reject(new Error(`No matching redirect within ${timeoutMs}ms.`))
          closeAll()
        }, timeoutMs)
      : undefined

    const finish = async (redirectUrl: string): Promise<void> => {
      if (settled) return
      settled = true
      const raw = await session.fromPartition(STORE_PARTITION).cookies.get({ url: redirectUrl })
      clearTimeout(timer)
      resolve({
        redirectUrl,
        cookies: raw.map((c) => ({ name: c.name, value: c.value, domain: c.domain ?? '' }))
      })
      closeAll()
    }

    // Both events, on every window in the flow: will-redirect catches server 30x hops
    // that never commit a navigation, did-navigate catches everything client-side. A
    // social sign-in can complete inside the popup, so watching only the opener would
    // wait out the timeout on exactly the flow popups were allowed for.
    const watch = (contents: Electron.WebContents): void => {
      contents.on('will-redirect', (_e, next) => {
        if (match.test(next)) void finish(next)
      })
      contents.on('did-navigate', (_e, next) => {
        if (match.test(next)) void finish(next)
      })
    }
    watch(authWindow.webContents)

    // Social sign-in opens popups, and sending them to the system browser would put them
    // in a different cookie jar, so the flow could never complete. about:blank is allowed
    // because `window.open('about:blank')` then assigning location is the common shape.
    authWindow.webContents.setWindowOpenHandler(({ url: target }) => {
      if (!isPopupAllowed(target)) return { action: 'deny' }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          parent: authWindow,
          webPreferences: { ...UNTRUSTED_PREFS }
        }
      }
    })

    authWindow.webContents.on('did-create-window', (popup) => {
      popups.add(popup)
      watch(popup.webContents)
      popup.on('closed', () => popups.delete(popup))
    })

    authWindow.on('closed', () => {
      clearTimeout(timer)
      for (const popup of popups) if (!popup.isDestroyed()) popup.destroy()
      popups.clear()
      if (!settled) reject(new Error('Sign-in window was closed before completing.'))
    })

    void authWindow.loadURL(url)
  })
}

/** Parsed, not prefix-matched: `HTTPS://` is https and `https:foo` is not a page. */
function isPopupAllowed(target: string): boolean {
  if (target === 'about:blank' || target === '') return true
  try {
    return new URL(target).protocol === 'https:'
  } catch {
    return false
  }
}

// Same partition as the auth window, or the login session's cookies are invisible here.
export async function cookies(url: string): Promise<Cookie[]> {
  requireHttps(url, 'A cookie lookup')
  const raw = await session.fromPartition(STORE_PARTITION).cookies.get({ url })
  return raw.map((c) => ({ name: c.name, value: c.value, domain: c.domain ?? '' }))
}

/**
 * The bridge is https-only. net.fetch happily serves file:// — a renderer asking for
 * file:///etc/passwd got 200 and the contents — so an unconstrained URL here turns any
 * renderer flaw into arbitrary local file read, with this same bridge available to post
 * it back out. Every store endpoint is https, so nothing legitimate is lost.
 */
function requireHttps(raw: string, what: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${what} needs a valid URL.`)
  }
  if (url.protocol !== 'https:') throw new Error(`${what} allows https only, not ${url.protocol}`)
  return url
}

export async function http(request: HttpRequest): Promise<HttpResponse> {
  requireHttps(request.url, 'A store request')
  const response = await net.fetch(request.url, {
    method: request.method ?? 'GET',
    headers: request.headers,
    body: request.body
  })
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text()
  }
}

export const database = {
  query: async (sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> =>
    getDb().prepare(sql).all(...params) as Record<string, unknown>[],
  run: async (sql: string, params: unknown[] = []): Promise<void> => {
    getDb().prepare(sql).run(...params)
  }
}

function readSecrets(): Record<string, string> {
  const file = secretsPath()
  if (!existsSync(file)) return {}
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>
}

/** Connector keys only, so a renderer flaw cannot range over the whole keychain file. */
const SECRET_KEY = /^(steam|gog|epic|other)\.(refreshToken|cookies)$/

function requireKnownKey(key: string): void {
  if (!SECRET_KEY.test(key)) throw new Error(`Refused: "${key}" is not a connector secret.`)
}

export const secrets = {
  get: async (key: string): Promise<string | null> => {
    requireKnownKey(key)
    const stored = readSecrets()[key]
    if (!stored) return null
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'))
    } catch {
      // The keychain key is gone or was minted for another app name. Drop the blob so
      // the store reads as signed out and can be reconnected, rather than throwing on
      // every isConnected() with no in-app way to clear it.
      await secrets.delete(key)
      return null
    }
  },
  set: async (key: string, value: string): Promise<void> => {
    requireKnownKey(key)
    // A refresh token in a plain file is the exact liability that has already bitten us.
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS keychain unavailable — refusing to store a token unencrypted.')
    }
    const all = readSecrets()
    all[key] = safeStorage.encryptString(value).toString('base64')
    writeFileSync(secretsPath(), JSON.stringify(all, null, 2), { mode: 0o600 })
  },
  delete: async (key: string): Promise<void> => {
    requireKnownKey(key)
    const all = readSecrets()
    delete all[key]
    writeFileSync(secretsPath(), JSON.stringify(all, null, 2), { mode: 0o600 })
  }
}
