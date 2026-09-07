import {
  app, BrowserWindow, ipcMain, net, protocol, session, shell, type IpcMainInvokeEvent
} from 'electron'
import { join, relative, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  authenticate, cookies, database, http, secrets, STORE_PARTITION, type SerializedPattern
} from './platform.js'
import type { HttpRequest } from '@ludoteca/core'

const isDev = process.env['LUDOTECA_DEV'] === '1'
const DEV_URL = 'http://localhost:5173'

// Served over a scheme of our own rather than file://, so the app has a real origin —
// which is what `'self'` in the CSP, and same-origin checks generally, are defined against.
const APP_SCHEME = 'ludoteca'
const APP_HOST = 'app'
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`
const UI_ROOT = join(__dirname, '../renderer')

// Pinned so both shells agree. Electron's default app name comes from package.json's
// `name` in development and productName once packaged, and safeStorage mints its keychain
// entry per app name — so a name that changes with how the app was launched makes every
// stored token undecryptable in the other shell.
app.setName('Ludoteca')

const appOrigin = isDev ? DEV_URL : APP_ORIGIN

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true }
  }
])

function serveApp(): void {
  protocol.handle(APP_SCHEME, (request) => {
    const { host, pathname } = new URL(request.url)
    // Every host is a separate origin, and origin-scoped storage with it. Serving the
    // bundle from any of them would hand a second copy of the app a second database.
    if (host !== APP_HOST) return new Response('Not found', { status: 404 })

    let decoded: string
    try {
      decoded = pathname === '/' ? 'index.html' : decodeURIComponent(pathname)
    } catch {
      return new Response('Bad request', { status: 400 })
    }

    const target = join(UI_ROOT, decoded)
    // join() collapses ..; this is what stops a crafted path escaping the bundle. The
    // empty case is the bundle root itself, which resolves to a directory.
    const inside = relative(UI_ROOT, target)
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(target).toString())
  })
}

/** Node's URL gives a non-special scheme no origin, so compare the parts that exist. */
function originOf(raw: string): string | null {
  try {
    const url = new URL(raw)
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

/**
 * `store_url` and `metacritic_url` are import columns, so their scheme is whatever a
 * file said it was. shell.openExternal hands that to the OS handler, which is how a
 * library file turns into arbitrary local execution.
 */
function openExternally(raw: string): void {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return
  void shell.openExternal(parsed.href)
}

/**
 * The app window passes the IPC sender check, so letting it navigate anywhere would hand
 * a remote page the whole preload surface — database and keychain included.
 */
function confineToApp(window: BrowserWindow): void {
  // Fails closed: an unparseable URL is null, and null never equals the app's origin.
  const allowed = (next: string): boolean => {
    const origin = originOf(next)
    return origin !== null && origin === originOf(appOrigin)
  }

  window.webContents.on('will-navigate', (event, next) => {
    if (allowed(next)) return
    event.preventDefault()
    openExternally(next)
  })

  // will-navigate covers the main frame only; a subframe navigating fires this instead.
  // `frame-src 'none'` already blocks frames, so this is the second layer rather than
  // the only one — which is what the CSP being relaxed later would otherwise cost.
  window.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame || allowed(event.url)) return
    event.preventDefault()
  })
}

// Nothing here needs a camera, a location or notifications; the sign-in windows render
// store pages that may well ask.
function denyAllPermissions(): void {
  const deny = (): boolean => false
  for (const partition of [session.defaultSession, session.fromPartition(STORE_PARTITION)]) {
    partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    partition.setPermissionCheckHandler(deny)
  }
}

/**
 * Cover art is the only remote content the app document loads; everything else it needs
 * comes over IPC. Dev needs the Vite websocket, which `'self'` does not cover.
 */
function applyContentSecurityPolicy(): void {
  const policy = [
    "default-src 'self'",
    isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    isDev ? "connect-src 'self' ws://localhost:5173" : "connect-src 'self'",
    "font-src 'self' data:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')

  // Scoped to the app's own documents. Unfiltered, this rewrites the headers of every
  // response on the default session — including the store API calls platform.http makes
  // through net.fetch, which were coming back with a Content-Security-Policy stapled on.
  const appUrls = isDev ? [`${DEV_URL}/*`] : [`${APP_ORIGIN}/*`]

  session.defaultSession.webRequest.onHeadersReceived({ urls: appUrls }, (details, callback) => {
    callback({
      responseHeaders: { ...(details.responseHeaders ?? {}), 'Content-Security-Policy': [policy] }
    })
  })
}

// Every window this app opened. The metadata window is a second one, and IPC must
// accept it while still refusing the sign-in windows, which render store pages.
const ownWindowIds = new Set<number>()

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 780,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Captured now: by the time 'closed' fires the window is destroyed and reading
  // webContents off it throws "Object has been destroyed".
  const windowId = window.webContents.id
  ownWindowIds.add(windowId)
  window.on('closed', () => ownWindowIds.delete(windowId))

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url)
    return { action: 'deny' }
  })
  confineToApp(window)

  void window.loadURL(isDev ? DEV_URL : APP_ORIGIN)
}

// Only the app window may reach these. The sign-in windows render untrusted store
// pages, so an unchecked handler would be reachable from a third party's JavaScript.
function handle<A extends unknown[], R>(
  channel: string,
  fn: (...args: A) => Promise<R>
): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!ownWindowIds.has(event.sender.id)) {
      throw new Error(`Refused ${channel}: sender is not an application window.`)
    }
    return fn(...(args as A))
  })
}

// Every Platform member is reachable only through these; the renderer holds no Node.
function registerPlatformHandlers(): void {
  handle('platform:authenticate', (url: string, pattern: SerializedPattern, title?: string, timeoutMs?: number) =>
    authenticate(url, pattern, title, timeoutMs)
  )
  handle('platform:cookies', (url: string) => cookies(url))
  handle('platform:http', (request: HttpRequest) => http(request))

  handle('db:query', (sql: string, params?: unknown[]) => database.query(sql, params))
  handle('db:run', (sql: string, params?: unknown[]) => database.run(sql, params))

  handle('secrets:get', (key: string) => secrets.get(key))
  handle('secrets:set', (key: string, value: string) => secrets.set(key, value))
  handle('secrets:delete', (key: string) => secrets.delete(key))
}

void app.whenReady().then(() => {
  if (!isDev) serveApp()
  denyAllPermissions()
  applyContentSecurityPolicy()
  registerPlatformHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
