// The entire surface a shell must provide. Electron, Tauri and later Capacitor each
// implement this; nothing above it knows which one it is running inside.

export interface Cookie {
  name: string
  value: string
  domain: string
}

export interface HttpRequest {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
}

export interface HttpResponse {
  status: number
  headers: Record<string, string>
  body: string
}

/** Where an intercepted login landed: the full redirect URL, plus that session's cookies. */
export interface AuthResult {
  redirectUrl: string
  cookies: Cookie[]
}

export interface AuthRequest {
  url: string
  /** Interception stops at the first navigation whose URL matches. */
  redirectPattern: RegExp
  title?: string
  /** Reject if no matching navigation happens in this long. */
  timeoutMs?: number
}

export interface Database {
  exec(sql: string): Promise<void>
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  run(sql: string, params?: unknown[]): Promise<void>
}

/** Backed by the OS keychain on every platform. Never a plain file. */
export interface SecretStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

export interface Platform {
  readonly name: 'electron' | 'tauri' | 'capacitor'
  /** Hosts a real login page and resolves once it navigates to the store's fixed redirect. */
  authenticate(request: AuthRequest): Promise<AuthResult>
  cookies(url: string): Promise<Cookie[]>
  /** Native HTTP — no CORS, since store APIs send no CORS headers. */
  http(request: HttpRequest): Promise<HttpResponse>
  readonly db: Database
  readonly secrets: SecretStore
}
