import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { authenticate, cookies, database, http, secrets, type SerializedPattern } from './platform.js'
import type { HttpRequest } from '@ludoteca/core'

const isDev = process.env['LUDOTECA_DEV'] === '1'

let appWindowId: number | undefined

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

  appWindowId = window.webContents.id

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    void window.loadURL('http://localhost:5173')
  } else {
    void window.loadFile(join(__dirname, '../../../../packages/ui/dist/index.html'))
  }
}

// Only the app window may reach these. The sign-in windows render untrusted store
// pages, so an unchecked handler would be reachable from a third party's JavaScript.
function handle<A extends unknown[], R>(
  channel: string,
  fn: (...args: A) => Promise<R>
): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (event.sender.id !== appWindowId) {
      throw new Error(`Refused ${channel}: sender is not the application window.`)
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
  registerPlatformHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
