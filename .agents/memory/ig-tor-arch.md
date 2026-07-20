---
name: Instagram via Tor architecture
description: How the bot fetches Instagram data — Tor SOCKS5 proxy + session cookie, fallback chain, known limitations.
---

## How it works
- Tor runs as a child process (port 9050 SOCKS5, port 9051 control).
- Instagram private API (`i.instagram.com/api/v1/users/web_profile_info/`) is called through Tor with the `IG_SESSION_ID` env secret (URL-decoded).
- `tor-manager.js` manages the singleton Tor process and provides `newCircuit()` via the control port for 429 rotation.
- `ig-session.js` caches results 5 min, rate-limits API calls to 1/60s per account.

## Response status meanings
- 200 + user data → live data extracted (followers/following/posts/pic via CDN through Tor)
- 200 + null user → account banned/suspended
- 404 → account does not exist (banned)
- 400 → Instagram server-side schema bug (`ig_business_category_subvertical` deleted); hits ALL professional/business accounts (leomessi, cristiano, kyliejenner, etc.); NOT fixable by changing UA, headers, or API version
- 429 → Tor exit node blocked; rotate circuit via SIGNAL NEWNYM and retry once
- 401 → session temporarily flagged from IP hopping; recovers in minutes (see ig-session-temp-ban.md)

## Fallback chain for 400 (schema error)
1. Confirm active status via dumpor.com (200 = active, 404 = banned)
2. Get profile pic via `https://i.instagram.com/api/v1/users/{id}/info/` (returns profile_pic_url even without full auth)
3. Stats shown as last cached value or null if no prior data

## KNOWN_USER_IDS (hardcoded in ig-session.js)
- leomessi: 460563723
- cristiano: 173560420
- Add more as needed when accounts trigger 400

**Why:** Replit's IP is permanently blocked by Instagram. Tor bypasses this. The session ties data to a user but gets flagged when used from many different exit IPs.
