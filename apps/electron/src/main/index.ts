import { app, BrowserWindow, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  authenticate, cookies, database, http, secrets, STORE_PARTITION, type SerializedPattern
} from './platform.js'
import type { HttpRequest } from '@ludoteca/core'

const isDev = process.env['LUDOTECA_DEV'] === '1'
const DEV_URL = 'http://localhost:5173'

const appIndex = join(__dirname, '../../../../packages/ui/dist/index.html')
const appOrigin = isDev ? DEV_URL : pathToFileURL(appIndex).href

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
  window.webContents.on('will-navigate', (event, next) => {
    if (next === appOrigin || next.startsWith(`${appOrigin}#`) || next.startsWith(`${appOrigin}?`)) {
      return
    }
    event.preventDefault()
    openExternally(next)
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
 * Covers is the only remote content the app window loads; everything else it needs comes
 * over IPC. Dev additionally serves the bundle and its socket from the Vite origin.
 */
function applyContentSecurityPolicy(): void {
  const policy = [
    "default-src 'self'",
    isDev ? `script-src 'self' 'unsafe-inline' ${DEV_URL}` : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    isDev ? `connect-src 'self' ${DEV_URL} ws://localhost:5173` : "connect-src 'self'",
    "font-src 'self' data:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] }
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

  if (isDev) {
    void window.loadURL(DEV_URL)
  } else {
    void window.loadFile(appIndex)
  }
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

  handle('db:exec', (sql: string) => database.exec(sql))
  handle('db:query', (sql: string, params?: unknown[]) => database.query(sql, params))
  handle('db:run', (sql: string, params?: unknown[]) => database.run(sql, params))

  handle('secrets:get', (key: string) => secrets.get(key))
  handle('secrets:set', (key: string, value: string) => secrets.set(key, value))
  handle('secrets:delete', (key: string) => secrets.delete(key))
}

void app.whenReady().then(() => {
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
