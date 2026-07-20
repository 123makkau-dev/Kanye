/**
 * ig-session.js
 * Instagram data fetcher — Tor-based private API with multi-layer fallbacks.
 *
 * Strategy (in order):
 *   1. web_profile_info via Tor+session  → live stats + pic for most accounts
 *   2. /users/{id}/info/ via Tor         → profile pic when (1) returns 400 schema error
 *   3. dumpor.com                        → ban detection when session is dead
 *   4. In-memory cache                   → last-known stats when API is temporarily unavailable
 */

require('dotenv').config();
const axios      = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const torManager = require('./tor-manager');

// ─── Config ───────────────────────────────────────────────────────────────────

const IG_APP_ID  = '936619743392459';
const ANDROID_UA = 'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100; en_US; 453073712)';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Minimum gap between Instagram API calls for the same account (avoids flagging)
const MIN_CALL_INTERVAL = 60 * 1000;   // 60 s
// How long to trust a cached result before re-checking
const CACHE_TTL          = 5 * 60 * 1000;  // 5 min

// Pre-known user IDs for accounts that always trigger the 400 business-schema bug.
// Add more if you find other business accounts affected by the same issue.
const KNOWN_USER_IDS = {
  'leomessi':   '460563723',
  'cristiano':  '173560420',
  'kyliejenner':'302021765',
  'selenagomez':'460563723',   // placeholder — update if needed
};

// ─── In-process stores ────────────────────────────────────────────────────────

const resultCache    = new Map();   // username → { result, ts }  (cleared by clearCache)
const lastKnownGood  = new Map();   // username → result          (NEVER cleared — last successful API result)
const userIdCache    = new Map();   // username → string user-id (from successful API calls)
const lastApiCall    = new Map();   // username → ts of most recent Instagram API attempt

function sessionId() {
  const sid = process.env.IG_SESSION_ID_2;
  if (!sid) { console.error('[ig-bot2] IG_SESSION_ID_2 is not set — requests will be unauthenticated'); }
  return decodeURIComponent(sid || '');
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function torAgent() {
  return new SocksProxyAgent(`socks5://127.0.0.1:${torManager.SOCKS_PORT}`);
}

async function torGet(url, { responseType = 'json', extraHeaders = {} } = {}) {
  return axios.get(url, {
    headers: {
      'User-Agent': ANDROID_UA,
      'x-ig-app-id': IG_APP_ID,
      'Accept': '*/*',
      'Cookie': `sessionid=${sessionId()}`,
      ...extraHeaders,
    },
    httpsAgent: torAgent(),
    timeout: 25000,
    responseType,
    validateStatus: () => true,
  });
}

async function fetchBuf(url, useTor = false) {
  if (!url) return null;
  try {
    const opts = {
      headers: { 'Accept': 'image/*', 'User-Agent': useTor ? ANDROID_UA : BROWSER_UA },
      responseType: 'arraybuffer',
      timeout: 12000,
      validateStatus: () => true,
    };
    if (useTor) opts.httpsAgent = torAgent();
    const r = await axios.get(url, opts);
    if (r.status === 200) return Buffer.from(r.data);
  } catch (_) {}
  return null;
}

// ─── Fallback: dumpor.com (ban detection only, no stats) ─────────────────────

async function checkDumpor(username) {
  try {
    const r = await axios.get(`https://dumpor.com/v/${encodeURIComponent(username)}`, {
      headers: { 'User-Agent': BROWSER_UA }, timeout: 15000,
      validateStatus: () => true, maxRedirects: 5,
    });
    console.log(`[ig] dumpor/${username} → ${r.status}`);
    if (r.status === 404) return true;   // banned
    if (r.status === 200) {
      const t = (String(r.data).match(/<title>([^<]*)<\/title>/i)?.[1] ?? '').toLowerCase();
      if (t.includes("doesn't exist") || t.includes('not found')) return true; // banned
      return false; // active
    }
  } catch (_) {}
  return null;  // unknown
}

// ─── Primary: /api/v1/users/web_profile_info/ ─────────────────────────────────

const BASE_COOLDOWN_MS = 15 * 60 * 1000;
const MAX_COOLDOWN_MS  =  4 * 60 * 60 * 1000;
let sessionCooldownUntil = 0;
let consecutive401s      = 0;

function nextCooldownMs() {
  return Math.min(BASE_COOLDOWN_MS * Math.pow(2, consecutive401s), MAX_COOLDOWN_MS);
}

function saveLastKnownGood(username, result) {
  if (result && !result.schemaError) lastKnownGood.set(username, result);
}

// Returns result object | { schemaError:true } | null (blocked/cooldown)
async function callWebProfileInfo(username) {
  const now = Date.now();

  // Respect session cooldown — don't make any calls until it expires
  if (now < sessionCooldownUntil) {
    const secsLeft = Math.round((sessionCooldownUntil - now) / 1000);
    console.log(`[ig] Session cooldown active for ${username} — ${secsLeft}s remaining`);
    return null;
  }

  const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;

  // Strategy: rotate on 429 (IP blocked) up to 3 times; NEVER rotate on 401
  // (401 = session flagged from IP-hopping — more rotation makes it worse)
  let r;
  for (let attempt = 1; attempt <= 4; attempt++) {
    r = await torGet(url);
    console.log(`[ig] web_profile_info/${username} (circuit ${attempt}) → ${r.status}`);
    if (r.status !== 429) break;   // any non-429 is worth acting on
    if (attempt < 4) {
      console.warn(`[ig] 429 on circuit ${attempt} — rotating`);
      await torManager.newCircuit();
    }
  }

  // 401 = session flagged — exponential backoff so the session gets time to heal
  if (r.status === 401) {
    consecutive401s++;
    const cooldownMs = nextCooldownMs();
    sessionCooldownUntil = Date.now() + cooldownMs;
    const mins = Math.round(cooldownMs / 60000);
    console.warn(`[ig] 401 (streak=${consecutive401s}) — cooldown ${mins}m until ${new Date(sessionCooldownUntil).toISOString()}`);
    return null;
  }

  // Still 429 after 4 circuits = Instagram blocking all Tor exits right now
  if (r.status === 429) {
    console.warn(`[ig] 429 on all circuits for ${username} — deferring`);
    return null;
  }

  if (r.status === 404) {
    return { banned: true, followers: null, following: null, posts: null, profilePic: null, bio: '', isVerified: false };
  }

  // 400 = server-side schema bug (affects professional/business accounts like leomessi)
  // Account definitely exists — we just can't get full data from this endpoint
  if (r.status === 400) {
    console.warn(`[ig] 400 schema error for ${username}`);
    return { schemaError: true };
  }

  if (r.status !== 200) {
    console.warn(`[ig] Unexpected ${r.status} for ${username}`);
    return null;
  }

  // Successful response — reset backoff streak
  consecutive401s = 0;

  const user = r.data?.data?.user;
  if (!user) {
    return { banned: true, followers: null, following: null, posts: null, profilePic: null, bio: '', isVerified: false };
  }

  if (user.id) userIdCache.set(username, String(user.id));

  const followers  = String(user.edge_followed_by?.count ?? '');
  const following  = String(user.edge_follow?.count ?? '');
  const posts      = String(user.edge_owner_to_timeline_media?.count ?? '');
  const bio        = user.biography || '';
  const isVerified = !!user.is_verified;
  const picUrl     = user.profile_pic_url_hd || user.profile_pic_url || null;
  const profilePic = picUrl ? await fetchBuf(picUrl, true) : null;

  return { banned: false, followers, following, posts, profilePic, bio, isVerified };
}

// ─── Fallback: /api/v1/users/{id}/info/ (profile pic only) ───────────────────

async function fetchPicById(userId) {
  try {
    const url = `https://i.instagram.com/api/v1/users/${userId}/info/`;
    const r   = await torGet(url);
    if (r.status !== 200) return null;
    const picUrl = r.data?.user?.profile_pic_url || null;
    if (!picUrl) return null;
    return fetchBuf(picUrl, true);
  } catch (_) { return null; }
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function getPage(username) {
  const now = Date.now();

  // 1. Return from cache if still fresh
  const cached = resultCache.get(username);
  if (cached && (now - cached.ts) < CACHE_TTL) {
    console.log(`[ig] ${username} — cache hit`);
    return cached.result;
  }

  // 2. Rate-limit Instagram API calls per account
  const lastCall = lastApiCall.get(username) ?? 0;
  const canCallApi = torManager.isReady && (now - lastCall) >= MIN_CALL_INTERVAL;

  let result = null;

  if (canCallApi) {
    try {
      const primary = await callWebProfileInfo(username);

      if (primary === null) {
        // Session cooldown or all circuits blocked — use best available fallback
        const fallback = cached?.result ?? lastKnownGood.get(username) ?? null;
        if (fallback) {
          const src = cached ? 'stale cache' : 'last known good';
          console.log(`[ig] ${username} — blocked, returning ${src}`);
          return fallback;
        }
        console.warn(`[ig] ${username} — blocked, no fallback available`);
        return null;
      }

      lastApiCall.set(username, now);

      if (!primary.schemaError) {
        result = primary;
        saveLastKnownGood(username, result);
      } else {
        const userId = userIdCache.get(username) || KNOWN_USER_IDS[username.toLowerCase()];
        let profilePic = null;
        if (userId && torManager.isReady) {
          console.log(`[ig] ${username} — fetching pic via /info/${userId}`);
          profilePic = await fetchPicById(userId);
        }
        const prevStats = (cached?.result && !cached.result.banned ? cached.result : null)
                       ?? lastKnownGood.get(username) ?? null;
        result = {
          banned:     false,
          followers:  prevStats?.followers  ?? null,
          following:  prevStats?.following  ?? null,
          posts:      prevStats?.posts      ?? null,
          profilePic: profilePic,
          bio:        prevStats?.bio        ?? '',
          isVerified: prevStats?.isVerified ?? false,
        };
        console.log(`[ig] ${username} — active (400 schema), stats: ${result.followers ?? '?'}`);
      }
    } catch (err) {
      console.error(`[ig] ${username} exception: ${err.message}`);
      return cached?.result ?? lastKnownGood.get(username) ?? null;
    }
  } else {
    if (!torManager.isReady) {
      console.warn(`[ig] ${username} — Tor not ready, returning fallback`);
    } else {
      console.log(`[ig] ${username} — rate-limited, returning fallback`);
    }
    const fallback = cached?.result ?? lastKnownGood.get(username) ?? null;
    if (fallback) return fallback;
    const dumpor404 = await checkDumpor(username);
    result = {
      banned:     dumpor404 === true,
      followers:  null, following: null, posts: null,
      profilePic: null, bio: '', isVerified: false,
    };
  }

  // 3. Cache and return
  if (result !== null) {
    resultCache.set(username, { result, ts: now });
  }
  return result;
}

// Force a fresh API call next time getPage() is called for this username
function clearCache(username) {
  resultCache.delete(username);
  lastApiCall.delete(username);
}

// Returns seconds remaining in session cooldown, or 0 if not in cooldown
function getCooldownRemaining() {
  const remaining = sessionCooldownUntil - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

module.exports = { getPage, clearCache, getCooldownRemaining };
