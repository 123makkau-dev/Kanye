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

const resultCache  = new Map();   // username → { result, ts }
const userIdCache  = new Map();   // username → string user-id (from successful API calls)
const lastApiCall  = new Map();   // username → ts of most recent Instagram API attempt

function sessionId() {
  return decodeURIComponent(process.env.IG_SESSION_ID || '');
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

// Session-level cooldown: when Instagram flags our session (401), back off
// for SESSION_COOLDOWN_MS so the rate-limit can reset before we try again.
const SESSION_COOLDOWN_MS = 15 * 60 * 1000;  // 15 minutes
let sessionCooldownUntil = 0;

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

  // 401 = session flagged for IP-hopping — enter 15-min cooldown
  if (r.status === 401) {
    sessionCooldownUntil = Date.now() + SESSION_COOLDOWN_MS;
    console.warn(`[ig] 401 — session flagged, entering 15-min cooldown until ${new Date(sessionCooldownUntil).toISOString()}`);
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

  const user = r.data?.data?.user;
  if (!user) {
    // 200 + null user = account suspended/banned
    return { banned: true, followers: null, following: null, posts: null, profilePic: null, bio: '', isVerified: false };
  }

  // Cache user ID for later fallback use
  if (user.id) userIdCache.set(username, String(user.id));

  const followers  = String(user.edge_followed_by?.count ?? '');
  const following  = String(user.edge_follow?.count ?? '');
  const posts      = String(user.edge_owner_to_timeline_media?.count ?? '');
  const bio        = user.biography || '';
  const isVerified = !!user.is_verified;
  const picUrl     = user.profile_pic_url_hd || user.profile_pic_url || null;

  // Fetch profile pic through Tor (signed CDN URLs are IP-locked)
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
        // All circuits blocked — do NOT update lastApiCall so next check retries immediately
        console.warn(`[ig] ${username} — all circuits blocked, will retry next check`);
        if (cached) {
          console.log(`[ig] ${username} — returning stale cache while circuits recover`);
          return cached.result;
        }
        return null;
      }

      // Got a definitive answer — record call time to avoid hammering
      lastApiCall.set(username, now);

      if (!primary.schemaError) {
        // Live data from Instagram API
        result = primary;
      } else {
        // 400 schema error — account exists but IG API can't return full data (business account bug).
        // DO NOT trust dumpor's 200 for active status — dumpor caches old pages for banned accounts.
        // The Instagram 400 itself confirms the account is active (banned accounts get 404, not 400).
        const userId = userIdCache.get(username) || KNOWN_USER_IDS[username.toLowerCase()];
        let profilePic = null;
        if (userId && torManager.isReady) {
          console.log(`[ig] ${username} — fetching pic via /info/${userId}`);
          profilePic = await fetchPicById(userId);
        }
        // Use last known stats from cache if available
        const prevStats = cached?.result && !cached.result.banned ? cached.result : null;
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
      if (cached) return cached.result;
      return null;
    }
  } else {
    // Cannot call API (Tor not ready or within rate-limit window) — return cache if available
    if (!torManager.isReady) {
      console.warn(`[ig] ${username} — Tor not ready, returning cache`);
    } else {
      console.log(`[ig] ${username} — rate-limited (${Math.round((MIN_CALL_INTERVAL - (now - (lastApiCall.get(username) ?? 0))) / 1000)}s remaining), returning cache`);
    }
    if (cached) return cached.result;
    // No cache and can't call API — last resort: use dumpor for rough ban check only
    // Only treat dumpor 404 as banned; 200 is NOT reliable (shows cached pages for banned accounts)
    const dumpor404 = await checkDumpor(username);
    result = {
      banned:     dumpor404 === true,   // only mark banned if dumpor explicitly 404s
      followers:  null,
      following:  null,
      posts:      null,
      profilePic: null,
      bio:        '',
      isVerified: false,
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

module.exports = { getPage, clearCache };
