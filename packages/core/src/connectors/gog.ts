import type { Platform } from '../platform.js'
import type { OwnedGame, StoreConnector } from './types.js'

// GOG Galaxy's own client id — you cannot register your own, and the redirect below
// is fixed by that client, which is why a hosted callback cannot be used.
const CLIENT_ID = '46899977096215655'
const REDIRECT_URL = 'https://embed.gog.com/on_login_success?origin=client'
const AUTH_URL =
  `https://auth.gog.com/auth?client_id=${CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URL)}&response_type=code&layout=client2`

const TOKEN_KEY = 'gog.refreshToken'

export class GogConnector implements StoreConnector {
  readonly id = 'gog' as const

  constructor(private readonly platform: Platform) {}

  async isAuthenticated(): Promise<boolean> {
    return (await this.platform.secrets.get(TOKEN_KEY)) !== null
  }

  async authenticate(): Promise<void> {
    const result = await this.platform.authenticate({
      url: AUTH_URL,
      redirectPattern: /on_login_success.*[?&]code=/,
      title: 'Sign in to GOG'
    })

    const code = new URL(result.redirectUrl).searchParams.get('code')
    if (!code) throw new Error('GOG redirect carried no authorization code.')

    // Token exchange deliberately unimplemented until the interception spike passes —
    // see the P0 item in the backlog.
    throw new Error(`Not implemented: exchange GOG code (${code.slice(0, 6)}…) for a token.`)
  }

  async fetchLibrary(): Promise<OwnedGame[]> {
    throw new Error('Not implemented: GOG getFilteredProducts.')
  }
}
