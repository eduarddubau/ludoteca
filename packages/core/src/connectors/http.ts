import type { HttpRequest, HttpResponse, Platform } from '../platform.js'

/**
 * Sent on every store request. Lutris sets one on both its Steam and Epic sessions, and
 * sending none is itself a fingerprint — these are endpoints meant for a launcher or a
 * browser, and an absent User-Agent is the one thing no real client does.
 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** A store said the session is over, whatever status code it dressed it up as. */
export class SessionExpiredError extends Error {
  constructor(public readonly store: string) {
    super(`Your ${store} sign-in has expired. Connect again to refresh it.`)
    this.name = 'SessionExpiredError'
  }
}

export function storeRequest(request: HttpRequest): HttpRequest {
  return { ...request, headers: { 'User-Agent': USER_AGENT, ...request.headers } }
}

/**
 * Parses a store response as JSON, treating an HTML body as an expired session rather
 * than a parse failure. Lutris relies on the same signal: GOG answers a dead token with
 * a login page under a 200, and "Unexpected token < in JSON" tells the user nothing.
 */
export async function storeJson<T>(
  platform: Platform,
  store: string,
  request: HttpRequest
): Promise<T> {
  const response: HttpResponse = await platform.http(storeRequest(request))

  // 401 is unambiguous. 403 is not: it also covers rate limiting and region blocks, and
  // telling a throttled user to sign in again invites exactly the repeated logins that
  // got a Steam account restricted.
  if (response.status === 401) throw new SessionExpiredError(store)
  if (response.status === 403) {
    throw new Error(
      `${store} refused the request (HTTP 403). This is usually rate limiting — wait before retrying rather than signing in again.`
    )
  }
  if (response.status !== 200) {
    throw new Error(`${store} request failed (HTTP ${response.status}).`)
  }
  if (response.body.trimStart().startsWith('<')) {
    throw new SessionExpiredError(store)
  }

  try {
    return JSON.parse(response.body) as T
  } catch {
    throw new Error(`${store} returned a response that could not be read as JSON.`)
  }
}
