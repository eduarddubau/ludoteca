import type { Platform } from '../platform.js'
import type { AuthResultSummary, OwnedGame, StoreConnector } from './types.js'

// GOG Galaxy's own OAuth client. You cannot register your own, and the redirect below is
// fixed by that client — which is why a loopback callback is no use and the sign-in has
// to be hosted in a webview whose navigation we can watch. These credentials are public:
// every open-source GOG client (lgogdownloader, Heroic, gogdl) uses this same pair.
const CLIENT_ID = '46899977096215655'
const CLIENT_SECRET = '9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9'
const REDIRECT_URL = 'https://embed.gog.com/on_login_success?origin=client'

const AUTH_URL =
  `https://auth.gog.com/auth?client_id=${CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URL)}&response_type=code&layout=client2`

const TOKEN_KEY = 'gog.refreshToken'

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  user_id: string
}

interface GogProduct {
  id: number
  title: string
  image: string
  url: string
  category: string
  slug: string
  isGame: boolean
  isMovie: boolean
  releaseDate: { date: string } | null
}

interface ProductsPage {
  page: number
  totalPages: number
  products: GogProduct[]
}

export class GogConnector implements StoreConnector {
  readonly id = 'gog' as const

  constructor(private readonly platform: Platform) {}

  async isAuthenticated(): Promise<boolean> {
    return (await this.platform.secrets.get(TOKEN_KEY)) !== null
  }

  async authenticate(): Promise<AuthResultSummary> {
    const result = await this.platform.authenticate({
      url: AUTH_URL,
      // GOG hops auth.gog.com → login.gog.com before landing here.
      redirectPattern: /on_login_success.*[?&]code=/,
      title: 'Sign in to GOG'
    })

    const code = new URL(result.redirectUrl).searchParams.get('code')
    if (!code) throw new Error('GOG redirect carried no authorization code.')

    const token = await this.exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URL
    })
    await this.platform.secrets.set(TOKEN_KEY, token.refresh_token)
    return { accountName: await this.username(token.access_token) }
  }

  /** The token response carries only a user id, so the display name needs its own call. */
  private async username(accessToken: string): Promise<string | undefined> {
    const response = await this.platform.http({
      url: 'https://embed.gog.com/userData.json',
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (response.status !== 200) return undefined
    return (JSON.parse(response.body) as { username?: string }).username
  }

  private async exchange(params: Record<string, string>): Promise<TokenResponse> {
    const url = new URL('https://auth.gog.com/token')
    url.searchParams.set('client_id', CLIENT_ID)
    url.searchParams.set('client_secret', CLIENT_SECRET)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

    const response = await this.platform.http({ url: url.toString() })
    if (response.status !== 200) {
      throw new Error(`GOG token exchange failed (HTTP ${response.status}).`)
    }
    return JSON.parse(response.body) as TokenResponse
  }

  /** Access tokens last about an hour, so one is minted per sync from the refresh token. */
  private async accessToken(): Promise<string> {
    const refreshToken = await this.platform.secrets.get(TOKEN_KEY)
    if (!refreshToken) throw new Error('Not signed in to GOG.')

    const token = await this.exchange({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
    // GOG rotates the refresh token, so the new one has to replace the stored one.
    await this.platform.secrets.set(TOKEN_KEY, token.refresh_token)
    return token.access_token
  }

  async fetchLibrary(): Promise<OwnedGame[]> {
    const accessToken = await this.accessToken()
    const games: OwnedGame[] = []

    let page = 1
    let totalPages = 1

    do {
      const response = await this.platform.http({
        url: `https://embed.gog.com/account/getFilteredProducts?mediaType=1&page=${page}`,
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      if (response.status !== 200) {
        throw new Error(`GOG library request failed (HTTP ${response.status}).`)
      }

      const body = JSON.parse(response.body) as ProductsPage
      totalPages = body.totalPages
      for (const product of body.products) {
        if (product.isMovie || !product.isGame) continue
        games.push(toOwnedGame(product))
      }
      page += 1
    } while (page <= totalPages)

    return games
  }
}

function toOwnedGame(product: GogProduct): OwnedGame {
  return {
    store: 'gog',
    storeGameId: String(product.id),
    title: product.title,
    ownership: { kind: 'owned' },
    // getFilteredProducts carries no playtime, so status is unknown until enriched.
    playStatus: 'unknown',
    genres: product.category ? [product.category] : [],
    releaseYear: product.releaseDate ? Number(product.releaseDate.date.slice(0, 4)) : undefined,
    storeUrl: `https://www.gog.com${product.url}`,
    // Protocol-relative and extension-less as served; enrichment usually replaces this
    // with Steam's 600x900 capsule, which suits the tile shape better.
    coverUrl: product.image ? `https:${product.image}.jpg` : undefined
  }
}
