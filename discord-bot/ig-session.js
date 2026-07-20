/**
 * Instagram status checker — dual-source approach:
 *   PRIMARY  : imginn.com  → full stats for indexed (usually larger) accounts
 *   FALLBACK : dumpor.com  → existence check only for small / unindexed accounts
 *
 * Returns { banned, followers, following, posts, profilePic, bio, isVerified }
 * or null on hard fetch error.
 */
const axios = require('axios');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Connection': 'keep-alive',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseCount(str) {
  if (!str) return null;
  const s = str.replace(/,/g, '').trim();
  if (/k$/i.test(s)) return String(Math.round(parseFloat(s) * 1_000));
  if (/m$/i.test(s)) return String(Math.round(parseFloat(s) * 1_000_000));
  if (/b$/i.test(s)) return String(Math.round(parseFloat(s) * 1_000_000_000));
  return s;
}

async function fetchBuffer(url) {
  if (!url) return null;
  try {
    const r = await axios.get(url, {
      headers: { ...HEADERS, 'Accept': 'image/*' },
      responseType: 'arraybuffer',
      timeout: 10000,
      validateStatus: () => true,
    });
    if (r.status === 200) return Buffer.from(r.data);
  } catch (_) {}
  return null;
}

/**
 * Parse stats from imginn's og:description.
 * Format (end of string): "… N Followers, N Following, N Posts"
 * The number BEFORE each label word is what we want — we search
 * the og:description string only, so stray page numbers can't interfere.
 */
function parseImginnDesc(desc) {
  if (!desc) return { followers: null, following: null, posts: null };

  const NUM = '([\\d][\\d,\\.]*[KMBkmb]?)';

  // Followers — must NOT be followed by "ing" (avoids matching "Following")
  const fRaw  = desc.match(new RegExp(NUM + '\\s*[Ff]ollowers?(?!ing)', 'i'))?.[1] ?? null;

  // Following — grab the last match so "…Followers, 368 Following…" picks 368
  const foAll = [...desc.matchAll(new RegExp(NUM + '\\s*[Ff]ollowing', 'gi'))];
  const foRaw = foAll.length ? foAll[foAll.length - 1][1] : null;

  // Posts — look inside og:description only
  const pRaw  = desc.match(new RegExp(NUM + '\\s*[Pp]osts?', 'i'))?.[1] ?? null;

  return {
    followers: fRaw  ? parseCount(fRaw)  : null,
    following: foRaw ? parseCount(foRaw) : null,
    posts:     pRaw  ? parseCount(pRaw)  : null,
  };
}

// ─── Primary source: imginn.com ───────────────────────────────────────────────

async function checkImginn(username) {
  const url = `https://imginn.com/${encodeURIComponent(username)}/`;
  const r = await axios.get(url, {
    headers: HEADERS,
    timeout: 20000,
    validateStatus: () => true,
    maxRedirects: 5,
  });

  console.log(`[ig] imginn/${username} → ${r.status}`);

  if (r.status === 404 || r.status === 410) {
    // imginn returns 4xx either for banned accounts OR for small unindexed ones.
    // We don't treat this as a definitive ban — the caller will run the fallback.
    return { notIndexed: true };
  }

  if (r.status !== 200) return null; // unexpected — treat as error

  const body = String(r.data);

  // Title sanity check
  const title = body.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '';
  if (title.toLowerCase().includes('page not found')) {
    return { banned: true, followers: null, following: null, posts: null, profilePic: null, bio: '', isVerified: false };
  }

  // Parse stats from og:description ONLY (avoids the feed-post-count false match)
  const ogDesc = body.match(/property="og:description"\s+content="([^"]*)"/i)?.[1]
              ?? body.match(/name="og:description"\s+content="([^"]*)"/i)?.[1]
              ?? '';

  const { followers, following, posts } = parseImginnDesc(ogDesc);
  console.log(`[ig] imginn/${username} parsed → f=${followers} fo=${following} p=${posts}`);

  // Profile pic from imginn CDN — decode HTML entities before fetching
  const picUrlRaw = body.match(/property="og:image"\s+content="([^"]+)"/i)?.[1] ?? null;
  const picUrl = picUrlRaw ? picUrlRaw.replace(/&#38;/g, '&').replace(/&amp;/g, '&') : null;
  const profilePic = picUrl ? await fetchBuffer(picUrl) : null;

  const isVerified = /verified/i.test(body) && !body.toLowerCase().includes('not verified');

  // Extract bio from og:description (strip the trailing stats line)
  const bio = ogDesc.replace(/\s*[\d][\d,.]*[KMBkmb]?\s+[Ff]ollowers?.*$/i, '').trim();

  // If we got zero stats AND body is short, imginn may not have the profile
  if (!followers && !following && !posts) {
    console.warn(`[ig] imginn/${username} — no stats in og:description, treating as not-indexed`);
    return { notIndexed: true };
  }

  return { banned: false, followers, following, posts, profilePic, bio, isVerified };
}

// ─── Fallback source: dumpor.com ─────────────────────────────────────────────
// Used only when imginn doesn't have the account indexed.
// Dumpor returns 404 for banned/deleted and 200 for active accounts.

async function checkDumpor(username) {
  const url = `https://dumpor.com/v/${encodeURIComponent(username)}`;
  const r = await axios.get(url, {
    headers: HEADERS,
    timeout: 15000,
    validateStatus: () => true,
    maxRedirects: 5,
  });

  console.log(`[ig] dumpor/${username} → ${r.status}`);

  if (r.status === 404) {
    return { banned: true, followers: null, following: null, posts: null, profilePic: null, bio: '', isVerified: false };
  }

  if (r.status === 200) {
    const body = String(r.data);
    const titleLow = (body.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '').toLowerCase();
    if (titleLow.includes("doesn't exist") || titleLow.includes('not found')) {
      return { banned: true, followers: null, following: null, posts: null, profilePic: null, bio: '', isVerified: false };
    }
    // Account exists — no follower counts available from dumpor without JS rendering
    return { banned: false, followers: null, following: null, posts: null, profilePic: null, bio: '', isVerified: false };
  }

  return null; // unexpected status — error
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function getPage(username) {
  try {
    // 1. Try imginn first
    const primary = await checkImginn(username);

    if (primary === null) return null;           // hard error
    if (!primary.notIndexed) return primary;     // got full data (or confirmed banned)

    // 2. imginn didn't have this account — confirm with dumpor
    console.log(`[ig] ${username} not on imginn, checking dumpor…`);
    const fallback = await checkDumpor(username);
    return fallback;

  } catch (err) {
    console.error(`[ig] ${username} error:`, err.message);
    return null;
  }
}

module.exports = { getPage };
