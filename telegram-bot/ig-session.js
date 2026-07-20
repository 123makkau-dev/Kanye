/**
 * ig-session.js (Telegram Bot)
 * Uses IG_SESSION_ID_TG — separate session from the Discord bots.
 */

const axios        = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const torManager   = require('./tor-manager');

const CACHE_TTL        = 5 * 60 * 1000;   // 5 min result cache
const MIN_CALL_INTERVAL = 60 * 1000;      // 60 s per-account rate limit
const SESSION_COOLDOWN_MS = 15 * 60 * 1000; // 15 min on 401

const resultCache = new Map();
const lastApiCall = new Map();
const userIdCache = new Map();

let sessionCooldownUntil = 0;

function getSessionId() {
  return decodeURIComponent(process.env.IG_SESSION_ID_TG || process.env.IG_SESSION_ID || '');
}

function makeAgent(circuit = 1) {
  if (!torManager.isReady) return undefined;
  return new SocksProxyAgent(`socks5://127.0.0.1:${torManager.SOCKS_PORT}`);
}

async function fetchBuf(url, useProxy = true) {
  try {
    const agent = useProxy ? makeAgent() : undefined;
    const r = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000,
      httpsAgent: agent,
      httpAgent: agent,
    });
    if (!r.data) return null;
    return Buffer.from(r.data);
  } catch (_) { return null; }
}

// ─── Dumpor fallback (ban check only) ────────────────────────────────────────
async function checkDumpor(username) {
  try {
    const r = await axios.get(`https://dumpor.com/v/${encodeURIComponent(username)}`, {
      timeout: 12000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    console.log(`[ig-tg] dumpor/${username} → ${r.status}`);
    if (r.status === 404) return true;
    if (r.status === 200) return false;
  } catch (err) {
    if (err.response?.status === 404) return true;
  }
  return null;
}

// ─── Primary: Instagram web_profile_info ─────────────────────────────────────
async function fetchFromIG(username, circuit = 1) {
  const now = Date.now();
  if (now < sessionCooldownUntil) {
    const secsLeft = Math.round((sessionCooldownUntil - now) / 1000);
    console.log(`[ig-tg] Session cooldown active for ${username} — ${secsLeft}s remaining`);
    return null;
  }

  const sessionId = getSessionId();
  const agent = makeAgent(circuit);
  const headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    'Accept': '*/*',
    'x-ig-app-id': '936619743392459',
    ...(sessionId ? { 'Cookie': `sessionid=${sessionId}` } : {}),
  };

  try {
    const r = await axios.get(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, {
      headers,
      timeout: 12000,
      httpsAgent: agent,
      httpAgent: agent,
      validateStatus: () => true,
    });
    console.log(`[ig-tg] web_profile_info/${username} (circuit ${circuit}) → ${r.status}`);

    if (r.status === 401) {
      sessionCooldownUntil = Date.now() + SESSION_COOLDOWN_MS;
      console.warn(`[ig-tg] 401 — session flagged, cooldown until ${new Date(sessionCooldownUntil).toISOString()}`);
      return null;
    }
    if (r.status === 429) {
      console.error(`[ig-tg] 429 on circuit ${circuit} — rotating`);
      if (circuit < 4) {
        await torManager.newCircuit();
        return fetchFromIG(username, circuit + 1);
      }
      return null;
    }
    if (r.status === 404) {
      return { banned: true, followers: null, following: null, posts: null, profilePic: null, bio: '', isVerified: false };
    }
    if (r.status === 400) {
      console.warn(`[ig-tg] 400 schema error for ${username}`);
      return { schemaError: true };
    }
    if (r.status !== 200) return null;

    const user = r.data?.data?.user;
    if (!user) {
      return { banned: true, followers: null, following: null, posts: null, profilePic: null, bio: '', isVerified: false };
    }

    if (user.id) userIdCache.set(username.toLowerCase(), user.id);

    const picUrl = user.profile_pic_url_hd || user.profile_pic_url || null;
    const profilePic = picUrl ? await fetchBuf(picUrl, true) : null;

    return {
      banned:     false,
      followers:  user.edge_followed_by?.count ?? null,
      following:  user.edge_follow?.count       ?? null,
      posts:      user.edge_owner_to_timeline_media?.count ?? null,
      profilePic,
      bio:        user.biography || '',
      isVerified: user.is_verified || false,
    };
  } catch (err) {
    console.error(`[ig-tg] ${username} exception: ${err.message}`);
    return null;
  }
}

// ─── Fallback: /users/{id}/info/ for schema-error accounts ───────────────────
async function fetchInfoById(username) {
  const userId = userIdCache.get(username.toLowerCase());
  if (!userId) return null;
  try {
    const agent = makeAgent();
    const r = await axios.get(`https://i.instagram.com/api/v1/users/${userId}/info/`, {
      headers: { 'User-Agent': 'Instagram 123.0.0.21.114 Android' },
      timeout: 10000,
      httpsAgent: agent,
      httpAgent: agent,
      validateStatus: () => true,
    });
    if (r.status !== 200) return null;
    const picUrl = r.data?.user?.profile_pic_url || null;
    if (!picUrl) return null;
    return await fetchBuf(picUrl, true);
  } catch (_) { return null; }
}

// ─── Public: getPage ──────────────────────────────────────────────────────────
async function getPage(username) {
  const now    = Date.now();
  const cached = resultCache.get(username);

  if (cached && (now - cached.ts) < CACHE_TTL) {
    console.log(`[ig-tg] ${username} — cache hit`);
    return cached.result;
  }

  const canCallApi = torManager.isReady && (now - (lastApiCall.get(username) || 0)) >= MIN_CALL_INTERVAL;

  let result = null;

  if (canCallApi) {
    try {
      const primary = await fetchFromIG(username);

      if (primary === null) {
        // API call failed (429/timeout) — don't lock rate limit so next retry can try again
        if (!cached) return null;
        console.log(`[ig-tg] ${username} — API blocked, using cache`);
        return cached.result;
      }

      // Successful API response — now stamp the rate limit timer
      lastApiCall.set(username, now);

      if (!primary.schemaError) {
        result = primary;
      } else {
        // 400 schema error — business account
        let profilePic = await fetchInfoById(username);
        const prevStats = cached?.result && !cached.result.banned ? cached.result : null;
        result = {
          banned:     false,
          followers:  prevStats?.followers  ?? null,
          following:  prevStats?.following  ?? null,
          posts:      prevStats?.posts      ?? null,
          profilePic: profilePic || prevStats?.profilePic || null,
          bio:        prevStats?.bio        || '',
          isVerified: prevStats?.isVerified || false,
        };
      }
    } catch (err) {
      console.error(`[ig-tg] ${username} exception: ${err.message}`);
      return null;
    }
  } else {
    if (cached) return cached.result;
    const dumpor404 = await checkDumpor(username);
    return {
      banned:    dumpor404 === true,
      followers: null, following: null, posts: null, profilePic: null, bio: '', isVerified: false,
    };
  }

  if (result !== null) {
    resultCache.set(username, { result, ts: now });
  }
  return result;
}

function clearCache(username) {
  resultCache.delete(username);
  lastApiCall.delete(username);
}

function getCooldownRemaining() {
  const remaining = sessionCooldownUntil - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

module.exports = { getPage, clearCache, getCooldownRemaining };
