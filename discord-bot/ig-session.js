/**
 * Instagram status checker via imginn.com (third-party viewer).
 * Bypasses Replit's IP block since imginn fetches from their own servers.
 * Returns the same data shape the rest of bot.js expects.
 */
const axios = require('axios');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Connection': 'keep-alive',
};

function parseCount(str) {
  if (!str) return null;
  const s = str.replace(/,/g, '').trim();
  if (/k$/i.test(s)) return String(Math.round(parseFloat(s) * 1000));
  if (/m$/i.test(s)) return String(Math.round(parseFloat(s) * 1_000_000));
  if (/b$/i.test(s)) return String(Math.round(parseFloat(s) * 1_000_000_000));
  return s;
}

async function fetchProfilePic(url) {
  if (!url) return null;
  try {
    const r = await axios.get(url, {
      headers: HEADERS,
      responseType: 'arraybuffer',
      timeout: 10000,
      validateStatus: () => true,
    });
    if (r.status === 200) return Buffer.from(r.data);
  } catch (_) {}
  return null;
}

/**
 * Fetch Instagram profile info for `username`.
 * Returns { banned, followers, following, posts, profilePic, bio, isVerified }
 * or null on fetch error.
 */
async function getPage(username) {
  try {
    const url = `https://imginn.com/${encodeURIComponent(username)}/`;
    const r = await axios.get(url, {
      headers: HEADERS,
      timeout: 20000,
      validateStatus: () => true,
      maxRedirects: 5,
    });

    console.log(`[ig] ${username} → imginn status ${r.status}`);

    // 404 / 410 / 301 to home = banned or deleted account
    if (r.status === 404 || r.status === 410) {
      return { banned: true, followers: null, following: null, posts: null, profilePic: null, bio: '', isVerified: false };
    }

    if (r.status !== 200) {
      console.warn(`[ig] ${username} unexpected status ${r.status}`);
      return { rateLimited: true };
    }

    const body = String(r.data);

    // Check for "page not found" content
    const titleMatch = body.match(/<title>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1] : '';
    if (
      title.toLowerCase().includes('page not found') ||
      body.toLowerCase().includes("this account doesn") ||
      body.toLowerCase().includes('user not found')
    ) {
      return { banned: true, followers: null, following: null, posts: null, profilePic: null, bio: '', isVerified: false };
    }

    // ── Parse follower / following / posts ─────────────────────────────
    // imginn puts counts in a meta description or in spans near the word "Followers"
    // Pattern: "123.4K Followers" or "123,456 Followers"
    // imginn stats appear like: "513.9M Followers, 368 Following, 1528 Posts"
    // We must match each label independently, anchored so "Following" doesn't
    // accidentally grab the Followers number.
    const numPat = '([\\d][\\d,\\.]*[KMBkmb]?)';
    // Followers: number followed by optional whitespace/comma then "Followers" NOT "Following"
    const fRaw   = body.match(new RegExp(numPat + '\\s*[Ff]ollowers(?!ing)', 'i'))?.[1]
                || body.match(new RegExp(numPat + '[^<]{0,10}[Ff]ollowers(?!ing)', 'i'))?.[1]
                || null;
    // Following: grab the last number before the word "Following"
    const foMatch = [...body.matchAll(new RegExp(numPat + '[^<]{0,5}[Ff]ollowing', 'gi'))];
    const foRaw   = foMatch.length ? foMatch[foMatch.length - 1][1] : null;
    const pRaw   = body.match(new RegExp(numPat + '[^<]{0,10}[Pp]osts?', 'i'))?.[1] || null;

    const followers = fRaw  ? parseCount(fRaw)  : null;
    const following = foRaw ? parseCount(foRaw) : null;
    const posts     = pRaw  ? parseCount(pRaw)  : null;

    console.log(`[ig] ${username} parsed: followers=${followers} following=${following} posts=${posts}`);

    // ── Profile pic ────────────────────────────────────────────────────
    const picUrl = body.match(/property="og:image"\s+content="([^"]+)"/i)?.[1]
                || body.match(/name="og:image"\s+content="([^"]+)"/i)?.[1]
                || null;
    const profilePic = picUrl ? await fetchProfilePic(picUrl) : null;

    // ── Bio ────────────────────────────────────────────────────────────
    const bioMatch = body.match(/property="og:description"\s+content="([^"]*)"/i);
    const bio = bioMatch ? bioMatch[1].replace(/&#\d+;/g, '').trim() : '';

    // ── Verified ───────────────────────────────────────────────────────
    const isVerified = /verified/i.test(body) && !body.toLowerCase().includes('not verified');

    // If we have the page but zero data, treat as error not ban
    if (!followers && !following && !posts) {
      console.warn(`[ig] ${username} no stats parsed — possible scrape layout change`);
      // Return non-banned with null counts so the bot doesn't falsely flag a ban
      return { banned: false, followers: null, following: null, posts: null, profilePic, bio, isVerified };
    }

    return { banned: false, followers, following, posts, profilePic, bio, isVerified };

  } catch (err) {
    console.error(`[ig] ${username} fetch error:`, err.message);
    return null;
  }
}

module.exports = { getPage };
