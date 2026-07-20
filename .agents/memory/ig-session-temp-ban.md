---
name: IG session temp-ban pattern
description: When Instagram 401s with "Please wait a few minutes" — what it is, when it happens, how to recover.
---

## What it is
Instagram responds with HTTP 401 + `{"message":"Please wait a few minutes before you try again.","require_login":true,"logout_reason":6,"logout_expectedness":"inactive"}` when the session is used from too many different IP addresses in a short time. Tor rotates exit nodes on SIGNAL NEWNYM, and each new exit node has a different IP → Instagram flags this as suspicious.

## When it happens
- After many rapid test requests that trigger multiple circuit rotations
- After aggressive testing (not normal bot operation)

## How to recover
- Stop making requests for a few minutes (5–15 min)
- The session flag lifts automatically
- The bot should continue working normally

## Prevention
- `MIN_CALL_INTERVAL = 60s` in ig-session.js prevents hammering per-account
- CACHE_TTL = 5 min means repeated `,check` calls return cached results
- Only rotate circuit on 429 (exit node blocked), NOT on 401 or 400

## If session is permanently dead
- User needs to get a new session cookie from their Instagram login
- Update `IG_SESSION_ID` env secret with the new (URL-encoded) session value
- Test with curl through Tor to verify before restarting bot

**Why:** Instagram links session IDs to device/IP fingerprints. Tor's IP-hopping looks like account takeover to Instagram's fraud detection.
