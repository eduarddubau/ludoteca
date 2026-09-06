// Throwaway spike: can Ludoteca actually see family-shared games?
// Proves the riskiest assumption in the architecture before any app is built on it.
//
// Platform type is MobileApp, not WebBrowser: refreshAccessToken() works only for
// MobileApp (WebBrowser returns AccessDenied), while getWebCookies() supports both —
// so one login yields both routes to a token, and the spike can fall back between them.

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';
import { LoginSession, EAuthTokenPlatformType } from 'steam-session';

const TOKEN_FILE = join(dirname(fileURLToPath(import.meta.url)), 'steam.token.json');
const API = 'https://api.steampowered.com';
const PLATFORM = 'MobileApp';

if (process.argv.includes('--reset') && existsSync(TOKEN_FILE)) {
  unlinkSync(TOKEN_FILE);
  console.log('Stored token discarded.');
}

// Steam's token audience decides which endpoints accept it, so surface it on failure.
function tokenAudience(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return `aud=[${(payload.aud ?? []).join(', ')}] exp=${new Date(payload.exp * 1000).toISOString()}`;
  } catch {
    return 'unparseable';
  }
}

async function callApi(iface, method, accessToken, params = {}) {
  const url = new URL(`${API}/${iface}/${method}/v1/`);
  url.searchParams.set('access_token', accessToken);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) {
    const err = new Error(`${iface}/${method} -> HTTP ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  try {
    return JSON.parse(body).response;
  } catch {
    throw new Error(`${iface}/${method} returned non-JSON: ${body.slice(0, 200)}`);
  }
}

async function loginWithQr() {
  const session = new LoginSession(EAuthTokenPlatformType[PLATFORM]);
  const { qrChallengeUrl } = await session.startWithQR();

  console.log('\nScan this with the Steam Mobile app:\n');
  qrcode.generate(qrChallengeUrl, { small: true });
  console.log(`\nOr open: ${qrChallengeUrl}\n`);

  session.on('remoteInteraction', () => console.log('Scanned — waiting for approval on your phone…'));

  await new Promise((resolve, reject) => {
    session.on('authenticated', resolve);
    session.on('timeout', () => reject(new Error('QR challenge timed out')));
    session.on('error', reject);
  });

  const steamId = session.steamID.getSteamID64();
  console.log(`\nAuthenticated as ${session.accountName} (${steamId}).`);

  // Written before anything else can throw — a lost refresh token costs another scan.
  writeFileSync(TOKEN_FILE, JSON.stringify({ refreshToken: session.refreshToken, steamId, platform: PLATFORM }, null, 2));
  console.log(`Refresh token saved to ${TOKEN_FILE} (gitignored).`);

  return { session, steamId };
}

async function resumeOrLogin() {
  if (existsSync(TOKEN_FILE)) {
    const stored = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
    if (stored.platform === PLATFORM) {
      const session = new LoginSession(EAuthTokenPlatformType[PLATFORM]);
      session.refreshToken = stored.refreshToken;
      console.log(`Resumed stored session for ${stored.steamId}.`);
      return { session, steamId: stored.steamId };
    }
    console.log(`Stored token is a ${stored.platform} token; ${PLATFORM} is required. Re-authenticating.`);
  }
  return loginWithQr();
}

// The token Steam's own store pages use — the audience the family endpoints expect.
async function webApiTokenFromCookies(session) {
  const cookies = await session.getWebCookies();
  const res = await fetch('https://store.steampowered.com/pointssummary/ajaxgetasyncconfig', {
    headers: { Cookie: cookies.map((c) => c.split(';')[0]).join('; ') }
  });
  const { data } = await res.json();
  if (!data?.webapi_token) throw new Error('No webapi_token in the store config response.');
  return data.webapi_token;
}

async function readFamilyLibrary(accessToken, steamId, label) {
  console.log(`\nTrying the family endpoints with the ${label} token (${tokenAudience(accessToken)})`);
  const family = await callApi('IFamilyGroupsService', 'GetFamilyGroupForUser', accessToken, { steamid: steamId });
  const familyGroupId = family?.family_groupid;
  if (!familyGroupId) {
    console.log('  No family group on this account.');
    console.log(`  ${JSON.stringify(family)}`);
    return null;
  }
  console.log(`  family_groupid: ${familyGroupId} — ${family.family_group?.members?.length ?? '?'} member(s).`);

  // family_groupid is required despite the docs implying otherwise.
  const shared = await callApi('IFamilyGroupsService', 'GetSharedLibraryApps', accessToken, {
    family_groupid: familyGroupId,
    steamid: steamId,
    include_own: true,
    include_excluded: true,
    include_free: true
  });
  return shared?.apps ?? [];
}

const { session, steamId } = await resumeOrLogin();

await session.refreshAccessToken();
const mobileToken = session.accessToken;
console.log(`\nAccess token minted: ${tokenAudience(mobileToken)}`);

console.log('\n--- 1. Owned games, on the session token alone (no Web API key) ---');
const owned = await callApi('IPlayerService', 'GetOwnedGames', mobileToken, {
  steamid: steamId,
  include_appinfo: 1,
  include_played_free_games: 1
});
console.log(`Owned: ${owned.game_count} games.`);

// Steam zeroes every playtime when that privacy setting is off, which would kill
// sort-by-playtime outright — so measure it rather than eyeballing the first rows.
const games = owned.games ?? [];
const played = games.filter((g) => (g.playtime_forever ?? 0) > 0);
const totalHours = Math.round(games.reduce((n, g) => n + (g.playtime_forever ?? 0), 0) / 60);
console.log(`Playtime: ${played.length}/${games.length} games above zero, ${totalHours}h total.`);
for (const g of [...games].sort((a, b) => (b.playtime_forever ?? 0) - (a.playtime_forever ?? 0)).slice(0, 5)) {
  console.log(`  ${g.appid}  ${g.name}  (${Math.round((g.playtime_forever ?? 0) / 60)}h)`);
}

console.log('\n--- 2. Family group and shared library ---');
let apps;
try {
  apps = await readFamilyLibrary(mobileToken, steamId, 'mobile');
} catch (err) {
  console.log(`  Mobile token rejected: ${err.message}`);
  console.log('  Falling back to a web token minted from session cookies.');
  apps = await readFamilyLibrary(await webApiTokenFromCookies(session), steamId, 'web');
}

if (apps === null) {
  console.log('\nVERDICT: no family group, so the shared-library premise is untestable on this account.');
  process.exit(0);
}

const ownedIds = new Set((owned.games ?? []).map((g) => g.appid));
const sharedOnly = apps.filter((a) => !ownedIds.has(a.appid));

console.log(`\n--- 3. Result ---`);
console.log(`Shared library: ${apps.length} apps, ${sharedOnly.length} not in your own library.`);
for (const a of sharedOnly.slice(0, 10)) {
  const owners = (a.owner_steamids ?? []).join(', ');
  console.log(`  ${a.appid}  ${a.name}${a.exclude_reason ? '  [excluded: ' + a.exclude_reason + ']' : ''}  owners: ${owners}`);
}

console.log('\nVERDICT: family-shared titles are reachable. The premise holds.');
