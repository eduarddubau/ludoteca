import { contextBridge, ipcRenderer } from 'electron'
import type { AuthRequest, HttpRequest, Platform } from '@ludoteca/core'

// A RegExp does not survive the IPC boundary intact, so it crosses as source + flags
// and is rebuilt in the main process.
const bridge: Platform = {
  name: 'electron',
  authenticate: (request: AuthRequest) =>
    ipcRenderer.invoke(
      'platform:authenticate',
      request.url,
      { source: request.redirectPattern.source, flags: request.redirectPattern.flags },
      request.title,
      request.timeoutMs
    ),
  cookies: (url: string) => ipcRenderer.invoke('platform:cookies', url),
  http: (request: HttpRequest) => ipcRenderer.invoke('platform:http', request),
  db: {
    exec: (sql: string) => ipcRenderer.invoke('db:exec', sql),
    query: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:query', sql, params),
    run: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:run', sql, params)
  },
  secrets: {
    get: (key: string) => ipcRenderer.invoke('secrets:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('secrets:set', key, value),
    delete: (key: string) => ipcRenderer.invoke('secrets:delete', key)
  }
}

contextBridge.exposeInMainWorld('ludoteca', bridge)
