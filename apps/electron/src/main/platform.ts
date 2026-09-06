import { app, BrowserWindow, net, safeStorage, session } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import {
  MIGRATIONS, SCHEMA, SCHEMA_VERSION,
  type Cookie, type HttpRequest, type HttpResponse
} from '@ludoteca/core'

export interface SerializedPattern {
  source: string
  flags: string
}

const STORE_PARTITION = 'persist:stores'

// Opened on first use, not at import: app paths are only meaningful once Electron owns
// the process, and a failure here should surface at a call site rather than at load.
let db: Database.Database | undefined

// Deliberately not app.getPath('userData'), which resolves per-shell: this literal
// folder is what lets the Tauri build open the very same database.
function sharedDataDir(): string {
  const dir = join(app.getPath('appData'), 'ludoteca')
  mkdirSync(dir, { recursive: true })
  return dir
}

function getDb(): Database.Database {
  if (!db) {
    db = new Database(join(sharedDataDir(), 'ludoteca.db'))
    // WAL lets both shells read at once with a single writer.
    db.pragma('journal_mode = WAL')

    // CREATE TABLE IF NOT EXISTS never alters an existing table, so a database written
    // by an older build needs the migrations applied on top.
    const existing = Number((db.pragma('user_version', { simple: true }) as number) ?? 0)
    db.exec(SCHEMA)
    for (const migration of MIGRATIONS.filter((m) => m.version > existing && existing > 0)) {
      db.exec(migration.sql)
    }
    db.pragma(`user_version = ${SCHEMA_VERSION}`)
  }
  return db
}

// Secrets stay per-shell: safeStorage and Tauri's keyring share no format.
function secretsPath(): string {
  return join(sharedDataDir(), 'secrets.electron.json')
}

/**
 * Hosts the store's own login page and resolves at the first navigation matching the
 * store's fixed redirect. The redirect URI belongs to the official launcher client and
 * cannot be changed, which is why a loopback callback is no use here.
 */
export async function authenticate(
  url: string,
  pattern: SerializedPattern,
  title?: string,
  timeoutMs?: number
): Promise<{ redirectUrl: string; cookies: Cookie[] }> {
  const match = new RegExp(pattern.source, pattern.flags)

  const authWindow = new BrowserWindow({
    width: 980,
    height: 760,
    title: title ?? 'Sign in',
    autoHideMenuBar: true,
    webPreferences: { partition: STORE_PARTITION, sandbox: true }
  })

  return new Promise((resolve, reject) => {
    let settled = false

    const timer = timeoutMs
      ? setTimeout(() => {
          if (settled) return
          settled = true
          reject(new Error(`No matching redirect within ${timeoutMs}ms.`))
          authWindow.destroy()
        }, timeoutMs)
      : undefined

    const finish = async (redirectUrl: string): Promise<void> => {
      if (settled) return
      settled = true
      const raw = await authWindow.webContents.session.cookies.get({ url: redirectUrl })
      clearTimeout(timer)
      resolve({
        redirectUrl,
        cookies: raw.map((c) => ({ name: c.name, value: c.value, domain: c.domain ?? '' }))
      })
      authWindow.destroy()
    }

    // will-redirect catches server 30x hops that never become a committed navigation.
    authWindow.webContents.on('will-redirect', (_e, next) => {
      if (match.test(next)) void finish(next)
    })
    authWindow.webContents.on('did-navigate', (_e, next) => {
      if (match.test(next)) void finish(next)
    })


    authWindow.on('closed', () => {
      clearTimeout(timer)
      if (!settled) reject(new Error('Sign-in window was closed before completing.'))
    })

    void authWindow.loadURL(url)
  })
}

// Same partition as the auth window, or the login session's cookies are invisible here.
export async function cookies(url: string): Promise<Cookie[]> {
  const raw = await session.fromPartition(STORE_PARTITION).cookies.get({ url })
  return raw.map((c) => ({ name: c.name, value: c.value, domain: c.domain ?? '' }))
}

export async function http(request: HttpRequest): Promise<HttpResponse> {
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
  exec: async (sql: string): Promise<void> => {
    getDb().exec(sql)
  },
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

export const secrets = {
  get: async (key: string): Promise<string | null> => {
    const stored = readSecrets()[key]
    if (!stored) return null
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  },
  set: async (key: string, value: string): Promise<void> => {
    // A refresh token in a plain file is the exact liability that has already bitten us.
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS keychain unavailable — refusing to store a token unencrypted.')
    }
    const all = readSecrets()
    all[key] = safeStorage.encryptString(value).toString('base64')
    writeFileSync(secretsPath(), JSON.stringify(all, null, 2), { mode: 0o600 })
  },
  delete: async (key: string): Promise<void> => {
    const all = readSecrets()
    delete all[key]
    writeFileSync(secretsPath(), JSON.stringify(all, null, 2), { mode: 0o600 })
  }
}
