---
name: Watch command cache & cooldown lessons
description: Hard-won lessons about the ,watch command initial check and session cooldown interaction
---

## Rule: Never clear cache before the initial ,watch check

`igSession.clearCache(username)` belongs ONLY inside `setInterval` monitoring ticks — not before the initial `check(username)` call in the `,watch` command handler.

**Why:** If the Instagram session is in a 15-min cooldown (401), clearing the cache removes the only fallback. The API call returns null, no cache to fall back to, the user gets "Could not fetch" error. With the cache intact, the command can return a valid cached result even during cooldown.

**How to apply:** Keep `clearCache` in all ~10 setInterval callbacks (monitoring ticks need fresh data). Remove it from any one-time command-triggered check.

## Rule: Double-verify "banned" before committing in ,watch

A single `banned: true` result from `check()` should not immediately send the user into unban-watch mode. One transient 404 or null-user API response can be a false positive.

**Fix:** If first check returns `banned: true`, wait 4s, clear cache, check again. Use the second result if available.

**Why:** Instagram can briefly return 404/null for active accounts (nickname changes, profile updates, transient API glitches). A second check after a pause almost always returns the correct state.

## Rule: 401 cooldown resets on bot restart

`sessionCooldownUntil` is in-memory only. Restarting the bot resets it to 0. This is intentional for now (avoids stale cooldowns across deployments), but means a restart during cooldown will immediately retry Instagram and could re-trigger 401 if the underlying issue isn't resolved.
