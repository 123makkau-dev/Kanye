'use strict';

const { Telegraf } = require('telegraf');
const db           = require('./db');
const igSession    = require('./ig-session');

const TOKEN = process.env.TELEGRAM_TOKEN;
const bot   = new Telegraf(TOKEN);

const CHECK_INTERVAL = 40000; // 40s
const activeIntervals = new Map(); // username → intervalId

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtNum(n) {
  if (n === null || n === undefined) return '?';
  const num = parseInt(n);
  if (isNaN(num)) return '?';
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
  if (num >= 1_000_000)    return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1_000)        return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return num.toLocaleString();
}

function formatTimeTaken(startTime) {
  const diff = Math.abs(Date.now() - startTime);
  const hrs  = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  const secs = Math.floor((diff % 60_000) / 1_000);
  const parts = [];
  if (hrs  > 0) parts.push(`${hrs}h`);
  if (mins > 0) parts.push(`${mins}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  return parts.join(' ');
}

function fetchErrorMsg(username) {
  const secs = igSession.getCooldownRemaining();
  if (secs > 0) {
    const mins = Math.ceil(secs / 60);
    return `⏳ Instagram flagged our session. Cooling down — try again in <b>${mins} minute${mins !== 1 ? 's' : ''}</b>.`;
  }
  return `❌ Could not fetch <b>@${username}</b>. Instagram may be rate-limiting. Try again in a moment.`;
}

// ─── Canvas profile card ──────────────────────────────────────────────────────

async function takeScreenshot(username, followers, following, profilePicBuf, posts, bio, verified = false) {
  try {
    const { createCanvas, loadImage } = require('@napi-rs/canvas');

    const W = 800, PAD = 28;
    const AVATAR_SIZE = 100;
    const BIO_MAX_W   = 500;

    const bioLines = [];
    if (bio) {
      const tempC = createCanvas(1, 1);
      const tempX = tempC.getContext('2d');
      tempX.font  = '13px sans-serif';
      const words = bio.split(' ');
      let line = '';
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (tempX.measureText(test).width > BIO_MAX_W) {
          if (line) bioLines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) bioLines.push(line);
    }

    const H      = PAD + AVATAR_SIZE + PAD + (bioLines.length > 0 ? bioLines.length * 18 + 10 : 0);
    const canvas = createCanvas(W, Math.max(H, 170));
    const ctx    = canvas.getContext('2d');

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, canvas.height);

    const avatarX = PAD, avatarY = PAD;
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();

    if (profilePicBuf) {
      try {
        const img = await loadImage(profilePicBuf);
        ctx.drawImage(img, avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE);
      } catch (_) {
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE);
        ctx.fillStyle = '#888';
        ctx.font = `bold ${AVATAR_SIZE * 0.4}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(username[0].toUpperCase(), avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      }
    } else {
      const colors = ['#e74c3c','#3498db','#2ecc71','#9b59b6','#f39c12','#1abc9c','#e67e22'];
      ctx.fillStyle = colors[username.charCodeAt(0) % colors.length];
      ctx.fillRect(avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${AVATAR_SIZE * 0.4}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(username[0].toUpperCase(), avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();

    ctx.strokeStyle = '#555';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.arc(avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.stroke();

    if (verified) {
      const bx = avatarX + AVATAR_SIZE - 20, by = avatarY + AVATAR_SIZE - 20;
      ctx.fillStyle = '#0095f6';
      ctx.beginPath();
      ctx.arc(bx + 10, by + 10, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 1.8;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(bx + 4, by + 10);
      ctx.lineTo(bx + 8, by + 14);
      ctx.lineTo(bx + 16, by + 6);
      ctx.stroke();
    }

    const rx = avatarX + AVATAR_SIZE + 20;
    let   ry = PAD + 6;

    ctx.fillStyle = '#ffffff';
    ctx.font      = '500 18px sans-serif';
    ctx.fillText(username, rx, ry + 14);

    if (verified) {
      const uw = ctx.measureText(username).width;
      const bx2 = rx + uw + 8, by2 = ry + 2;
      ctx.fillStyle = '#0095f6';
      ctx.beginPath();
      ctx.arc(bx2 + 9, by2 + 9, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(bx2 + 3.5, by2 + 9);
      ctx.lineTo(bx2 + 7, by2 + 12.5);
      ctx.lineTo(bx2 + 14.5, by2 + 5.5);
      ctx.stroke();
    }

    ry += 30;

    ctx.fillStyle = '#0095f6';
    ctx.beginPath();
    ctx.roundRect(rx, ry, 80, 28, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font      = 'bold 13px sans-serif';
    ctx.fillText('Follow', rx + 16, ry + 18);

    ctx.fillStyle = '#2e2e2e';
    ctx.beginPath();
    ctx.roundRect(rx + 88, ry, 36, 28, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font      = 'bold 15px sans-serif';
    ctx.fillText('···', rx + 96, ry + 18);

    ry += 42;

    const stats   = [
      { num: fmtNum(posts),     label: 'posts' },
      { num: fmtNum(followers), label: 'followers' },
      { num: fmtNum(following), label: 'following' },
    ];
    let sx = rx;
    for (const s of stats) {
      ctx.fillStyle = '#ffffff';
      ctx.font      = 'bold 16px sans-serif';
      ctx.fillText(s.num, sx, ry);
      ctx.fillStyle = '#aaaaaa';
      ctx.font      = '12px sans-serif';
      ctx.fillText(s.label, sx, ry + 16);
      sx += 110;
    }
    ry += 34;

    if (bioLines.length > 0) {
      ctx.fillStyle = '#e0e0e0';
      ctx.font      = '13px sans-serif';
      for (const line of bioLines) {
        ctx.fillText(line, rx, ry);
        ry += 18;
      }
    }

    return canvas.toBuffer('image/png');
  } catch (err) {
    console.error('[screenshot] Canvas failed:', err.message);
    return null;
  }
}

// ─── Send ban/unban notification ──────────────────────────────────────────────

async function sendBanNotification(chatId, username, timeTaken, info) {
  const caption =
    `🔴 <b>@${username}</b> has been <b>BANNED</b>\n` +
    `⏱ Time taken: ${timeTaken}\n` +
    `👥 Followers: ${fmtNum(info?.followers)} · Following: ${fmtNum(info?.following)}`;

  const buf = info ? await takeScreenshot(username, info.followers, info.following, info.profilePic, info.posts, info.bio) : null;

  try {
    if (buf) {
      await bot.telegram.sendPhoto(chatId, { source: buf }, { caption, parse_mode: 'HTML' });
    } else {
      await bot.telegram.sendMessage(chatId, caption, { parse_mode: 'HTML' });
    }
  } catch (err) {
    console.error(`[notify] Failed to send ban alert to ${chatId}:`, err.message);
  }
}

async function sendUnbanNotification(chatId, username, timeTaken, info) {
  const caption =
    `🟢 <b>@${username}</b> has been <b>UNBANNED</b>\n` +
    `⏱ Time taken: ${timeTaken}\n` +
    `👥 Followers: ${fmtNum(info?.followers)} · Following: ${fmtNum(info?.following)}`;

  const buf = info ? await takeScreenshot(username, info.followers, info.following, info.profilePic, info.posts, info.bio) : null;

  try {
    if (buf) {
      await bot.telegram.sendPhoto(chatId, { source: buf }, { caption, parse_mode: 'HTML' });
    } else {
      await bot.telegram.sendMessage(chatId, caption, { parse_mode: 'HTML' });
    }
  } catch (err) {
    console.error(`[notify] Failed to send unban alert to ${chatId}:`, err.message);
  }
}

// ─── Check helpers ────────────────────────────────────────────────────────────

async function checkOnce(username) {
  try {
    const data = await igSession.getPage(username);
    if (!data) return null;
    console.log(`[check-tg] ${username} → banned=${data.banned} followers=${data.followers}`);
    return data;
  } catch (err) {
    console.error(`[check-tg] error for ${username}:`, err.message);
    return null;
  }
}

async function check(username, retries = 2) {
  for (let i = 0; i < retries; i++) {
    const result = await checkOnce(username);
    if (result !== null) return result;
    if (i < retries - 1) await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

// ─── Monitoring loop ──────────────────────────────────────────────────────────

function startWatchInterval(username, chatId, mode, startTime) {
  // Avoid duplicate intervals
  if (activeIntervals.has(username)) {
    clearInterval(activeIntervals.get(username));
  }

  const id = setInterval(async () => {
    igSession.clearCache(username);
    try {
      const info = await check(username);
      if (!info) {
        await db.incrementFail(username);
        const acc = await db.getAccount(username);
        if (acc && acc.failCount >= 5) {
          clearInterval(activeIntervals.get(username));
          activeIntervals.delete(username);
          console.log(`[watch-tg] ${username} — too many fails, stopping`);
        }
        return;
      }

      await db.resetFail(username);

      if (mode === 'ban' && info.banned) {
        // Was active, now banned
        clearInterval(activeIntervals.get(username));
        activeIntervals.delete(username);
        await db.updateStatus(username, 'banned');
        await db.logEvent(username, 'banned');
        await sendBanNotification(chatId, username, formatTimeTaken(startTime), info);
        console.log(`[watch-tg] 🔴 ${username} BANNED — alert sent`);
      } else if (mode === 'unban' && !info.banned) {
        // Was banned, now active
        clearInterval(activeIntervals.get(username));
        activeIntervals.delete(username);
        await db.updateStatus(username, 'active');
        if (info.followers) await db.updateFollowers(username, info.followers);
        await db.logEvent(username, 'recovered');
        await sendUnbanNotification(chatId, username, formatTimeTaken(startTime), info);
        console.log(`[watch-tg] 🟢 ${username} UNBANNED — alert sent`);
      }
    } catch (err) {
      console.error(`[watch-tg] ${username} error:`, err.message);
    }
  }, CHECK_INTERVAL);

  activeIntervals.set(username, id);
}

// ─── Restore watches on startup ───────────────────────────────────────────────

async function restoreWatches() {
  try {
    const banList   = await db.getBanWatchList();
    const unbanList = await db.getUnbanWatchList();

    console.log(`[Restore] Resuming ${banList.length} ban watch(es), ${unbanList.length} unban watch(es)...`);

    for (const acc of banList) {
      startWatchInterval(acc.username, acc.chatId, 'ban', acc.startTime.getTime());
    }
    for (const acc of unbanList) {
      startWatchInterval(acc.username, acc.chatId, 'unban', acc.startTime.getTime());
    }
  } catch (err) {
    console.error('[Restore] Failed:', err.message);
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

bot.command('start', async (ctx) => {
  await ctx.replyWithHTML(
    `👋 <b>Instagram Monitor Bot</b>\n\n` +
    `I monitor Instagram accounts for bans and unbans.\n\n` +
    `<b>Commands:</b>\n` +
    `/check &lt;username&gt; — check if an account is banned\n` +
    `/watch &lt;username&gt; — watch for ban or unban\n` +
    `/unwatch &lt;username&gt; — stop watching\n` +
    `/watchlist — show all watched accounts\n` +
    `/status — bot stats\n` +
    `/help — show this message`
  );
});

bot.command('help', async (ctx) => {
  await ctx.replyWithHTML(
    `<b>📋 Commands</b>\n\n` +
    `/check &lt;username&gt;\n` +
    `  One-time Instagram account lookup\n\n` +
    `/watch &lt;username&gt;\n` +
    `  Watch an active account for a ban\n` +
    `  Watch a banned account for an unban\n\n` +
    `/unwatch &lt;username&gt;\n` +
    `  Stop watching an account\n\n` +
    `/watchlist\n` +
    `  List all accounts being watched\n\n` +
    `/status\n` +
    `  Bot statistics\n\n` +
    `Notifications are sent to <b>this chat</b>.`
  );
});

bot.command('check', async (ctx) => {
  const args     = ctx.message.text.split(/\s+/).slice(1);
  const username = args[0]?.replace(/^@/, '').toLowerCase();
  if (!username) return ctx.replyWithHTML('Usage: /check &lt;username&gt;');

  const msg = await ctx.replyWithHTML(`🔍 Checking <b>@${username}</b>...`);

  const info = await check(username);
  if (!info) {
    return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      fetchErrorMsg(username), { parse_mode: 'HTML' });
  }

  const statusLine = info.banned
    ? `🔴 <b>BANNED</b>`
    : `🟢 <b>Active</b>${info.isVerified ? ' ✅ Verified' : ''}`;

  const caption =
    `${statusLine}\n` +
    `👤 <b>@${username}</b>\n` +
    `👥 Followers: ${fmtNum(info.followers)}\n` +
    `➡️ Following: ${fmtNum(info.following)}\n` +
    `📸 Posts: ${fmtNum(info.posts)}`;

  const buf = await takeScreenshot(username, info.followers, info.following, info.profilePic, info.posts, info.bio, info.isVerified);

  await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});

  if (buf) {
    await ctx.replyWithPhoto({ source: buf }, { caption, parse_mode: 'HTML' });
  } else {
    await ctx.replyWithHTML(caption);
  }
});

bot.command('watch', async (ctx) => {
  const args     = ctx.message.text.split(/\s+/).slice(1);
  const username = args[0]?.replace(/^@/, '').toLowerCase();
  if (!username) return ctx.replyWithHTML('Usage: /watch &lt;username&gt;');

  const chatId = String(ctx.chat.id);
  const msg    = await ctx.replyWithHTML(`🔍 Checking <b>@${username}</b>...`);

  // Use cached data if available, then verify
  const info = await check(username);
  if (!info) {
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      fetchErrorMsg(username), { parse_mode: 'HTML' });
    return;
  }

  // Double-verify if result looks wrong (same logic as Discord bot)
  let finalInfo = info;
  if (info.banned) {
    await new Promise(r => setTimeout(r, 4000));
    igSession.clearCache(username);
    const recheck = await check(username);
    if (recheck) finalInfo = recheck;
  }

  const isBanned = finalInfo.banned;
  const mode     = isBanned ? 'unban' : 'ban';

  await db.addAccount(username, chatId, isBanned ? 'banned' : 'active', finalInfo.followers);
  startWatchInterval(username, chatId, mode, Date.now());

  const watchMsg = isBanned
    ? `👀 Watching <b>@${username}</b> for an <b>unban</b>.\nI'll notify this chat when they're back.`
    : `👀 Watching <b>@${username}</b> for a <b>ban</b>.\nI'll notify this chat if they get banned.`;

  await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
    watchMsg, { parse_mode: 'HTML' });
});

bot.command('unwatch', async (ctx) => {
  const args     = ctx.message.text.split(/\s+/).slice(1);
  const username = args[0]?.replace(/^@/, '').toLowerCase();
  if (!username) return ctx.replyWithHTML('Usage: /unwatch &lt;username&gt;');

  const acc = await db.getAccount(username);
  if (!acc) return ctx.replyWithHTML(`❌ <b>@${username}</b> is not being watched.`);

  if (activeIntervals.has(username)) {
    clearInterval(activeIntervals.get(username));
    activeIntervals.delete(username);
  }
  await db.removeAccount(username);
  await ctx.replyWithHTML(`✅ Stopped watching <b>@${username}</b>.`);
});

bot.command('watchlist', async (ctx) => {
  const accounts = await db.getAccounts();
  if (!accounts.length) return ctx.replyWithHTML('📋 No accounts are being watched.');

  const lines = accounts.map(a => {
    const icon = a.lastStatus === 'banned' ? '🔴' : '🟢';
    const since = Math.floor((Date.now() - new Date(a.startTime).getTime()) / 60000);
    const sinceStr = since < 60
      ? `${since}m ago`
      : `${Math.floor(since / 60)}h ${since % 60}m ago`;
    return `${icon} <b>@${a.username}</b> — watching for ${a.lastStatus === 'banned' ? 'unban' : 'ban'} · started ${sinceStr}`;
  });

  await ctx.replyWithHTML(`<b>📋 Watch List (${accounts.length})</b>\n\n${lines.join('\n')}`);
});

bot.command('banlist', async (ctx) => {
  const accounts = await db.getBanWatchList();
  if (!accounts.length) return ctx.replyWithHTML('📋 No active accounts being watched for bans.');
  const lines = accounts.map(a => `🟢 <b>@${a.username}</b>`);
  await ctx.replyWithHTML(`<b>👁 Ban Watch List (${accounts.length})</b>\n\n${lines.join('\n')}`);
});

bot.command('unbanlist', async (ctx) => {
  const accounts = await db.getUnbanWatchList();
  if (!accounts.length) return ctx.replyWithHTML('📋 No banned accounts being watched for unbans.');
  const lines = accounts.map(a => `🔴 <b>@${a.username}</b>`);
  await ctx.replyWithHTML(`<b>👁 Unban Watch List (${accounts.length})</b>\n\n${lines.join('\n')}`);
});

bot.command('status', async (ctx) => {
  const stats = await db.getStats();
  await ctx.replyWithHTML(
    `<b>📊 Bot Status</b>\n\n` +
    `👁 Watching: ${activeIntervals.size} account(s)\n` +
    `📦 Total in DB: ${stats.totalWatched}\n` +
    `🔴 Total bans detected: ${stats.totalBanned}\n` +
    `🟢 Total unbans detected: ${stats.totalRecovered}`
  );
});

// ─── Error handler ────────────────────────────────────────────────────────────

bot.catch((err, ctx) => {
  console.error(`[bot-tg] Error for ${ctx.updateType}:`, err.message);
});

// ─── Start ────────────────────────────────────────────────────────────────────

module.exports = {
  start: async () => {
    await restoreWatches();
    await bot.launch();
    console.log(`✅ Telegram bot launched`);

    // Graceful shutdown
    process.once('SIGINT',  () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  }
};
