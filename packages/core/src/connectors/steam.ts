import { storeJson } from './http.js'
import type { Platform } from '../platform.js'
import type { AuthResultSummary, OwnedGame, StoreConnector } from './types.js'

/**
 * Signs in the way Lutris does: the ordinary Steam web login in a webview, then the
 * `webapi_token` read out of the store's own async config using that session's cookies.
 *
 * This deliberately replaces an earlier approach that used steam-session with the
 * MobileApp platform type. That impersonates the Steam mobile app from a desktop, and it
 * got an account restricted for suspected unauthorised access. A browser doing browser
 * things is unremarkable; a phone that is not a phone is not.
 */
const LOGIN_URL = 'https://store.steampowered.com/login/?redir=/about'
const TOKEN_URL = 'https://store.steampowered.com/pointssummary/ajaxgetasyncconfig'
const API = 'https://api.steampowered.com'

const COOKIE_KEY = 'steam.cookies'

interface AsyncConfig {
  data?: { webapi_token?: string }
}

interface OwnedGamesResponse {
  response: { game_count?: number; games?: SteamGame[] }
}

interface SteamGame {
  appid: number
  name?: string
  playtime_forever?: number
}

interface FamilyGroupResponse {
  response: { family_groupid?: string }
}

interface SharedAppsResponse {
  response: { apps?: SharedApp[] }
}

interface SharedApp {
  appid: number
  name?: string
  owner_steamids?: string[]
  exclude_reason?: number
  /** 1 is a game; the same list also carries DLC, soundtracks and tools. */
  app_type?: number
  /** Seconds, unlike GetOwnedGames' playtime_forever, which is minutes. */
  rt_playtime?: number
}

export class SteamConnector implements StoreConnector {
  readonly id = 'steam' as const

  constructor(private readonly platform: Platform) {}

  async isAuthenticated(): Promise<boolean> {
    return (await this.platform.secrets.get(COOKIE_KEY)) !== null
  }

  async authenticate(): Promise<AuthResultSummary> {
    const result = await this.platform.authenticate({
      url: LOGIN_URL,
      // Steam lands on /about once the sign-in completes.
      redirectPattern: /store\.steampowered\.com\/about/,
      title: 'Sign in to Steam'
    })

    const cookies = result.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    if (!cookies) throw new Error('Steam sign-in produced no session cookies.')
    await this.platform.secrets.set(COOKIE_KEY, cookies)

    // Prove the session actually works before reporting success.
    const token = await this.accessToken()
    return { accountName: steamIdFrom(token) }
  }

  /** Short-lived (~24h) and re-read per sync; the cookies are what persist. */
  private async accessToken(): Promise<string> {
    const cookies = await this.platform.secrets.get(COOKIE_KEY)
    if (!cookies) throw new Error('Not signed in to Steam.')

    const config = await storeJson<AsyncConfig>(this.platform, 'Steam', {
      url: TOKEN_URL,
      headers: { Cookie: cookies }
    })

    const token = config.data?.webapi_token
    if (!token) throw new Error('Your Steam sign-in has expired. Connect again to refresh it.')
    return token
  }

  private call<T>(token: string, path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${API}/${path}`)
    url.searchParams.set('access_token', token)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    return storeJson<T>(this.platform, 'Steam', { url: url.toString() })
  }

  async fetchLibrary(): Promise<OwnedGame[]> {
    const token = await this.accessToken()
    const steamId = steamIdFrom(token)
    if (!steamId) throw new Error('Could not read a Steam ID from the session token.')

    const owned = await this.call<OwnedGamesResponse>(token, 'IPlayerService/GetOwnedGames/v1/', {
      steamid: steamId,
      include_appinfo: '1',
      include_played_free_games: '1'
    })

    const games: OwnedGame[] = (owned.response.games ?? []).map((game) => ({
      store: 'steam',
      storeGameId: String(game.appid),
      title: game.name ?? `App ${game.appid}`,
      ownership: { kind: 'owned' },
      playStatus: game.playtime_forever ? 'played' : 'unplayed',
      playtimeMinutes: game.playtime_forever,
      genres: [],
      storeUrl: `https://store.steampowered.com/app/${game.appid}`
    }))

    games.push(...(await this.familyLibrary(token, steamId, new Set(games.map((g) => g.storeGameId)))))
    return games
  }

  /** The half that motivated the project: games playable but not owned. */
  private async familyLibrary(
    token: string,
    steamId: string,
    ownedIds: Set<string>
  ): Promise<OwnedGame[]> {
    const family = await this.call<FamilyGroupResponse>(
      token,
      'IFamilyGroupsService/GetFamilyGroupForUser/v1/',
      { steamid: steamId }
    )
    const familyGroupId = family.response.family_groupid
    if (!familyGroupId) return []

    // family_groupid is required despite the docs implying otherwise.
    const shared = await this.call<SharedAppsResponse>(
      token,
      'IFamilyGroupsService/GetSharedLibraryApps/v1/',
      {
        family_groupid: familyGroupId,
        steamid: steamId,
        include_own: 'true',
        include_excluded: 'true',
        include_free: 'false',
        language: 'english'
      }
    )

    return (shared.response.apps ?? [])
      // The response mixes DLC, soundtracks and tools in with the games.
      .filter((app) => app.app_type === 1 && !ownedIds.has(String(app.appid)))
      .map((app) => {
        // rt_playtime is seconds here, where GetOwnedGames reports minutes.
        const minutes = app.rt_playtime ? Math.round(app.rt_playtime / 60) : undefined
        return {
          store: 'steam' as const,
          storeGameId: String(app.appid),
          title: app.name ?? `App ${app.appid}`,
          ownership: {
            kind: 'familyShared' as const,
            ownerAccountId: app.owner_steamids?.[0] ?? '',
            excludeReason: app.exclude_reason
          },
          playStatus: minutes ? ('played' as const) : ('unplayed' as const),
          playtimeMinutes: minutes,
          genres: [],
          storeUrl: `https://store.steampowered.com/app/${app.appid}`
        }
      })
  }
}

/** The webapi_token is a JWT whose subject is the Steam ID. */
function steamIdFrom(token: string): string | undefined {
  try {
    const payload = token.split('.')[1]
    const decoded = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    ) as { sub?: string }
    return decoded.sub
  } catch {
    return undefined
  }
}
