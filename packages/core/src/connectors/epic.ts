import type { Platform } from '../platform.js'
import type { AuthResultSummary, OwnedGame, StoreConnector } from './types.js'

// The Epic Games Launcher's own OAuth client, as used by Legendary and Heroic. Epic
// publishes no library API, so this is the only route — and Epic's own redirect page
// warns that the code "allows full access to your Epic account", which is why it is
// exchanged immediately and only the refresh token is ever stored.
const CLIENT_ID = '34a02cf8f4414e29b15921876da36f9a'
const CLIENT_SECRET = 'daafbccc737745039dffe53d94fc76cf'

const TOKEN_URL = 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token'
const REDIRECT_URL = `https://www.epicgames.com/id/api/redirect?clientId=${CLIENT_ID}&responseType=code`
const LOGIN_URL = `https://www.epicgames.com/id/login?redirectUrl=${encodeURIComponent(REDIRECT_URL)}`
const LIBRARY_URL = 'https://library-service.live.use1a.on.epicgames.com/library/api/public/items'
const CATALOG_URL = 'https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/namespace'

const TOKEN_KEY = 'epic.refreshToken'
/** Epic rejects very long query strings, so catalog lookups go out in batches. */
const CATALOG_BATCH = 40

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  account_id: string
  displayName?: string
}

interface LibraryRecord {
  catalogItemId: string
  namespace: string
  appName: string
}

interface LibraryPage {
  records: LibraryRecord[]
  responseMetadata: { nextCursor?: string }
}

interface CatalogItem {
  title: string
  categories?: { path: string }[]
  keyImages?: { type: string; url: string }[]
  developer?: string
}

export class EpicConnector implements StoreConnector {
  readonly id = 'epic' as const

  constructor(private readonly platform: Platform) {}

  async isAuthenticated(): Promise<boolean> {
    return (await this.platform.secrets.get(TOKEN_KEY)) !== null
  }

  /**
   * Epic hands the authorization code back in a JSON *body*, not a URL — unlike GOG. So
   * the webview is used only to establish a session, and the code is then read by calling
   * the redirect endpoint with that session's cookies.
   */
  async authenticate(): Promise<AuthResultSummary> {
    const result = await this.platform.authenticate({
      url: LOGIN_URL,
      redirectPattern: /\/id\/api\/redirect/,
      title: 'Sign in to Epic Games'
    })

    const cookieHeader = result.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    const response = await this.platform.http({
      url: REDIRECT_URL,
      headers: { Cookie: cookieHeader }
    })
    if (response.status !== 200) {
      throw new Error(`Epic redirect endpoint returned HTTP ${response.status}.`)
    }

    const { authorizationCode } = JSON.parse(response.body) as { authorizationCode: string | null }
    if (!authorizationCode) {
      throw new Error('Epic returned no authorization code — the sign-in did not complete.')
    }

    const token = await this.exchange({
      grant_type: 'authorization_code',
      code: authorizationCode,
      token_type: 'eg1'
    })
    await this.platform.secrets.set(TOKEN_KEY, token.refresh_token)
    return { accountName: token.displayName }
  }

  private async exchange(params: Record<string, string>): Promise<TokenResponse> {
    const response = await this.platform.http({
      url: TOKEN_URL,
      method: 'POST',
      headers: {
        Authorization: `basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(params).toString()
    })
    if (response.status !== 200) {
      throw new Error(`Epic token exchange failed (HTTP ${response.status}).`)
    }
    return JSON.parse(response.body) as TokenResponse
  }

  private async accessToken(): Promise<string> {
    const refreshToken = await this.platform.secrets.get(TOKEN_KEY)
    if (!refreshToken) throw new Error('Not signed in to Epic.')

    const token = await this.exchange({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      token_type: 'eg1'
    })
    await this.platform.secrets.set(TOKEN_KEY, token.refresh_token)
    return token.access_token
  }

  private async records(accessToken: string): Promise<LibraryRecord[]> {
    const all: LibraryRecord[] = []
    let cursor: string | undefined

    do {
      const url = new URL(LIBRARY_URL)
      url.searchParams.set('includeMetadata', 'true')
      if (cursor) url.searchParams.set('cursor', cursor)

      const response = await this.platform.http({
        url: url.toString(),
        headers: { Authorization: `bearer ${accessToken}` }
      })
      if (response.status !== 200) {
        throw new Error(`Epic library request failed (HTTP ${response.status}).`)
      }

      const page = JSON.parse(response.body) as LibraryPage
      all.push(...page.records)
      cursor = page.responseMetadata?.nextCursor
    } while (cursor)

    return all
  }

  /** The library returns ids only, so titles come from the catalog, batched per namespace. */
  private async catalog(
    accessToken: string,
    namespace: string,
    ids: string[]
  ): Promise<Record<string, CatalogItem>> {
    const found: Record<string, CatalogItem> = {}

    for (let start = 0; start < ids.length; start += CATALOG_BATCH) {
      const url = new URL(`${CATALOG_URL}/${namespace}/bulk/items`)
      for (const id of ids.slice(start, start + CATALOG_BATCH)) {
        url.searchParams.append('id', id)
      }
      url.searchParams.set('country', 'US')
      url.searchParams.set('locale', 'en')

      const response = await this.platform.http({
        url: url.toString(),
        headers: { Authorization: `bearer ${accessToken}` }
      })
      // A namespace can fail on its own; one bad batch should not lose the whole library.
      if (response.status !== 200) continue
      Object.assign(found, JSON.parse(response.body) as Record<string, CatalogItem>)
    }

    return found
  }

  async fetchLibrary(): Promise<OwnedGame[]> {
    const accessToken = await this.accessToken()
    const records = await this.records(accessToken)

    const byNamespace = new Map<string, LibraryRecord[]>()
    for (const record of records) {
      const list = byNamespace.get(record.namespace)
      if (list) list.push(record)
      else byNamespace.set(record.namespace, [record])
    }

    const games: OwnedGame[] = []
    for (const [namespace, group] of byNamespace) {
      const items = await this.catalog(
        accessToken,
        namespace,
        group.map((record) => record.catalogItemId)
      )

      for (const record of group) {
        const item = items[record.catalogItemId]
        if (!item || !isGame(item)) continue
        games.push(toOwnedGame(record, item))
      }
    }

    return games
  }
}

/** The library carries DLC and tooling alongside games; only base games belong here. */
function isGame(item: CatalogItem): boolean {
  const paths = (item.categories ?? []).map((category) => category.path)
  return paths.includes('games') && !paths.includes('addons')
}

function toOwnedGame(record: LibraryRecord, item: CatalogItem): OwnedGame {
  const art = (item.keyImages ?? []).find((image) => image.type === 'DieselGameBoxTall')
  return {
    store: 'epic',
    storeGameId: record.catalogItemId,
    title: item.title,
    ownership: { kind: 'owned' },
    // Epic reports no playtime at all — the reason 'No play data' exists as a shelf.
    playStatus: 'unknown',
    genres: [],
    developer: item.developer,
    // Epic has no stable public store URL from a catalog id, so this stays a search.
    coverUrl: art?.url
  }
}
