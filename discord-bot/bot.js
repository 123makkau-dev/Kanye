require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db   = require('./db');
const fs   = require('fs');
const path = require('path');

// ─── Custom Emojis ────────────────────────────────────────────────────────────
const EM = {
  online:   '🟢',
  idle:     '🌙',
  dnd:      '🔴',
  offline:  '⚫',
  ban:      '🔥',
  unban:    '✅',
  eye:      '👁️',
  active:   '🟢',
  banned:   '🔴',
  verify:   '🔵',
  ok:       '✅',
  err:      '❌',
  load:     '⏳',
  warn:     '⚠️',
  crown:    '👑',
  partner:  '🤝',
  premium:  '⭐',
  stats:    '📊',
  medal1:   '🥇',
  medal2:   '🥈',
  medal3:   '🥉',
  time:     '⏱️',
  announce: '📢',
  wrench:   '🔧',
  verified: '✅',
};

// ─── Config ───────────────────────────────────────────────────────────────────
const TOKEN            = process.env.DISCORD_TOKEN;
const ALLOWED_USER_IDS = process.env.ALLOWED_USER_IDS ? process.env.ALLOWED_USER_IDS.split(',') : [];

// Two owners — hardcoded + env
const OWNER_IDS = [
  process.env.OWNER_ID_1 || '',
  process.env.OWNER_ID_2 || ''
].filter(Boolean);

const allowedUserIds = [...ALLOWED_USER_IDS, ...OWNER_IDS];

// Channel IDs — loaded from MongoDB, fallback to env vars
// Use global.__basedir (set by index.js) so it works inside pkg exe too
const CHANNELS_PATH = path.join(global.__basedir || __dirname, 'channels.json');
let channelConfig   = { banChannelId: null, unbanChannelId: null, pingRoleId: null, verifyChannelId: null };

function loadChannels() {
  try { channelConfig = JSON.parse(fs.readFileSync(CHANNELS_PATH, 'utf8')); } catch (_) {}
}
async function loadChannelsFromDB() {
  try {
    const saved = await db.getConfig('channelConfig');
    if (saved) channelConfig = { ...channelConfig, ...saved };
    if (!channelConfig.banChannelId   && process.env.BAN_CHANNEL_ID)   channelConfig.banChannelId   = process.env.BAN_CHANNEL_ID;
    if (!channelConfig.unbanChannelId && process.env.UNBAN_CHANNEL_ID) channelConfig.unbanChannelId = process.env.UNBAN_CHANNEL_ID;
  } catch (_) {}
}
function saveChannels() {
  try { fs.writeFileSync(CHANNELS_PATH, JSON.stringify(channelConfig, null, 2)); } catch (_) {}
  db.setConfig('channelConfig', channelConfig).catch(() => {});
}
loadChannels();

// Track active intervals
const activeWatches = new Map();

// Dynamic settings
let PREFIX        = ',';
let checkInterval = parseInt(process.env.CHECK_INTERVAL) || 40000;

const BOT_START     = Date.now();
const pausedWatches = new Set();
let   MAINTENANCE   = false; // maintenance mode flag

// ─── Discord Client ───────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

// ─── Instagram Checker (Puppeteer — real Chrome browser) ─────────────────────
const IG_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'image/*'
};

function parseNum(str) {
  if (!str) return null;
  str = str.trim();
  if (/[Kk]$/.test(str)) return String(Math.round(parseFloat(str) * 1000));
  if (/[Mm]$/.test(str)) return String(Math.round(parseFloat(str) * 1000000));
  if (/[Bb]$/.test(str)) return String(Math.round(parseFloat(str) * 1000000000));
  return str.replace(/,/g, '');
}

// ─── Instagram check via imginn.com (bypasses Replit IP block) ───────────────
const igSession = require('./ig-session');

async function checkOnce(username) {
  try {
    const data = await igSession.getPage(username);
    if (!data) return null;
    if (data.rateLimited) return null;
    // data is already fully parsed: { banned, followers, following, posts, profilePic, bio, isVerified }
    console.log(`[check] ${username} → banned=${data.banned} followers=${data.followers} following=${data.following}`);
    return data;
  } catch (err) {
    console.error(`[check] error for ${username}:`, err.message);
    return null;
  }
}

// Retry wrapper
async function check(username, retries = 2) {
  for (let i = 0; i < retries; i++) {
    const result = await checkOnce(username);
    if (result !== null) return result;
    if (i < retries - 1) await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTimestamp(date) {
  return `<t:${Math.floor(date.getTime() / 1000)}:f>`;
}

function formatTimeTaken(startTime) {
  const diff = Math.abs(Date.now() - startTime);
  const hrs  = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  const parts = [];
  if (hrs > 0)  parts.push(`${hrs} hour${hrs !== 1 ? 's' : ''}`);
  if (mins > 0) parts.push(`${mins} minute${mins !== 1 ? 's' : ''}`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs} second${secs !== 1 ? 's' : ''}`);
  return parts.join(', ');
}

function fmtNum(n) {
  if (n === null || n === undefined) return '?';
  const num = parseInt(n);
  if (isNaN(num)) return '?';
  if (num === 0) return '0';
  if (num >= 1000000000) return (num / 1000000000).toFixed(1).replace(/\.0$/, '') + 'B';
  if (num >= 1000000)    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1000)       return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return num.toLocaleString();
}

// Get or create alert channel
async function getAlertChannel(guild, type) {
  const id   = type === 'ban' ? channelConfig.banChannelId : channelConfig.unbanChannelId;
  const name = type === 'ban' ? '🔴ban-alerts' : '🟢unban-alerts';

  if (id) {
    const existing = guild.channels.cache.get(id);
    if (existing) return existing;
  }

  // Create channel
  try {
    const ch = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionFlagsBits.SendMessages] }
      ]
    });
    if (type === 'ban')   channelConfig.banChannelId   = ch.id;
    else                  channelConfig.unbanChannelId = ch.id;
    saveChannels();
    return ch;
  } catch (err) {
    console.error(`[channel] Failed to create ${name}:`, err.message);
    return null;
  }
}

async function sendErrorDM(userId, errorMessage) {
  try {
    const user = await client.users.fetch(userId);
    await user.send({ embeds: [
      new EmbedBuilder()
        .setTitle('❌ Error')
        .setDescription(`\`\`\`${errorMessage}\`\`\``)
        .setColor(0xFFFFFF)
    ]});
  } catch (_) {}
}

// Notify all DM-enabled users
async function notifyDmUsers(username, text) {
  try {
    const users = await db.getDmUsers();
    for (const u of users) {
      try {
        const discordUser = await client.users.fetch(u.userId);
        await discordUser.send(text);
      } catch (_) {}
    }
  } catch (_) {}
}
// ─── Screenshot card (canvas-based, no Puppeteer needed) ─────────────────────
async function takeScreenshot(username, followers, following, profilePicUrl, posts, bio, verified = false) {
  try {
    const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

    const W = 800, PAD = 28;
    const AVATAR_SIZE = 100;
    const BIO_MAX_W   = 500;

    // Measure bio lines
    const bioLines = [];
    if (bio) {
      const tempC = createCanvas(1, 1);
      const tempX = tempC.getContext('2d');
      tempX.font = '13px sans-serif';
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

    const H = PAD + AVATAR_SIZE + PAD + (bioLines.length > 0 ? bioLines.length * 18 + 10 : 0);
    const canvas = createCanvas(W, Math.max(H, 170));
    const ctx    = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, canvas.height);

    // Avatar
    const avatarX = PAD, avatarY = PAD;
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    if (profilePicUrl) {
      try {
        // profilePicUrl can be Buffer or base64 string
        const img = await loadImage(profilePicUrl);
        ctx.drawImage(img, avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE);
      } catch (_) {
        // Fallback: colored circle with initial
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
      // No pic — colored circle with initial
      const colors = ['#e74c3c','#3498db','#2ecc71','#9b59b6','#f39c12','#1abc9c','#e67e22'];
      const color  = colors[username.charCodeAt(0) % colors.length];
      ctx.fillStyle = color;
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

    // Avatar border
    ctx.strokeStyle = '#555';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.arc(avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.stroke();

    // Verified badge on avatar
    if (verified) {
      const bx = avatarX + AVATAR_SIZE - 20, by = avatarY + AVATAR_SIZE - 20;
      ctx.fillStyle = '#0095f6';
      ctx.beginPath();
      ctx.arc(bx + 10, by + 10, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 1.8;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      ctx.moveTo(bx + 4, by + 10);
      ctx.lineTo(bx + 8, by + 14);
      ctx.lineTo(bx + 16, by + 6);
      ctx.stroke();
    }

    // Right side start
    const rx = avatarX + AVATAR_SIZE + 20;
    let   ry = PAD + 6;

    // Username
    ctx.fillStyle = '#ffffff';
    ctx.font      = '500 18px sans-serif';
    ctx.fillText(username, rx, ry + 14);

    // Inline verified badge next to username
    if (verified) {
      const uw = ctx.measureText(username).width;
      const bx2 = rx + uw + 8, by2 = ry + 2;
      ctx.fillStyle = '#0095f6';
      ctx.beginPath();
      ctx.arc(bx2 + 9, by2 + 9, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 1.6;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      ctx.moveTo(bx2 + 3.5, by2 + 9);
      ctx.lineTo(bx2 + 7, by2 + 12.5);
      ctx.lineTo(bx2 + 14.5, by2 + 5.5);
      ctx.stroke();
    }

    ry += 30;

    // Follow button
    const btnX = rx, btnY = ry;
    ctx.fillStyle    = '#0095f6';
    ctx.beginPath();
    ctx.roundRect(btnX, btnY, 80, 28, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font      = 'bold 13px sans-serif';
    ctx.fillText('Follow', btnX + 16, btnY + 18);

    // More button
    ctx.fillStyle = '#2e2e2e';
    ctx.beginPath();
    ctx.roundRect(btnX + 88, btnY, 36, 28, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font      = 'bold 15px sans-serif';
    ctx.fillText('···', btnX + 96, btnY + 18);

    ry += 42;

    // Stats — number bold on top, label small below (no overlap)
    const stats = [
      { num: fmtNum(posts),     label: 'posts' },
      { num: fmtNum(followers), label: 'followers' },
      { num: fmtNum(following), label: 'following' }
    ];
    const statColW = 110;
    let sx = rx;
    for (const s of stats) {
      // Bold number
      ctx.fillStyle = '#ffffff';
      ctx.font      = 'bold 16px sans-serif';
      ctx.fillText(s.num, sx, ry);
      // Small grey label below
      ctx.fillStyle = '#aaaaaa';
      ctx.font      = '12px sans-serif';
      ctx.fillText(s.label, sx, ry + 16);
      sx += statColW;
    }

    ry += 34;

    // Bio
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

// Send recovered embed
async function sendRecoveredEmbed(channel, username, followers, following, timeTaken, profilePic, posts, bio) {
  const pingText = channelConfig.pingRoleId ? `<@&${channelConfig.pingRoleId}> ` : '';
  const f  = followers != null ? parseInt(followers).toLocaleString() : '?';
  const fo = following != null ? parseInt(following).toLocaleString() : '?';

  // Text outside embed — italic style like screenshot
  await channel.send(
    `${pingText}[Account Recovered | @${username}](https://www.instagram.com/${username}/) ✅\n` +
    `*Followers: ${f} | Following: ${fo}*\n` +
    `*⏱️ Time taken: ${timeTaken}*`
  );

  // Image in separate black embed
  const buf = await takeScreenshot(username, followers, following, profilePic, posts, bio);
  if (buf) {
    const att   = new AttachmentBuilder(buf, { name: `${username}.png` });
    const embed = new EmbedBuilder().setColor(0x000000).setImage(`attachment://${username}.png`);
    return channel.send({ embeds: [embed], files: [att] });
  }
}

// Send banned embed
async function sendBannedEmbed(channel, username, timeTaken, profilePic, followers, following, posts, bio) {
  const pingText = channelConfig.pingRoleId ? `<@&${channelConfig.pingRoleId}> ` : '';
  const f  = followers != null ? parseInt(followers).toLocaleString() : '?';
  const fo = following != null ? parseInt(following).toLocaleString() : '?';

  // Text outside embed — italic style
  await channel.send(
    `${pingText}[Account Has Been Smoked! | @${username}](https://www.instagram.com/${username}/) 🔥\n` +
    `*Followers: ${f} | Following: ${fo}*\n` +
    `*⏱️ Time taken: ${timeTaken}*`
  );

  // Image in separate black embed
  const buf = await takeScreenshot(username, followers, following, profilePic, posts, bio);
  if (buf) {
    const att   = new AttachmentBuilder(buf, { name: `${username}_banned.png` });
    const embed = new EmbedBuilder().setColor(0x000000).setImage(`attachment://${username}_banned.png`);
    return channel.send({ embeds: [embed], files: [att] });
  }
}

// ─── Ready ────────────────────────────────────────────────────────────────────
client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`[owners] OWNER_IDS: ${JSON.stringify(OWNER_IDS)}`);
  console.log(`[owners] allowedUserIds: ${JSON.stringify(allowedUserIds)}`);

  // Load channel config from MongoDB
  await loadChannelsFromDB();

  const accounts = await db.getAccounts();
  if (accounts.length > 0) console.log(`[Restore] Resuming ${accounts.length} watch(es)...`);

  for (const acc of accounts) {
    const username  = acc.username;
    const channelId = acc.channelId;
    const startTime = new Date(acc.startTime).getTime();
    const isBan     = acc.lastStatus === 'active';
    const watchKey  = isBan ? `ban_${username}` : `unban_${username}`;
    if (activeWatches.has(watchKey)) continue;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) { await db.removeAccount(username); continue; }

    if (isBan) {
      const intv = setInterval(async () => {
        try {
          if (pausedWatches.has(`ban_${username}`)) return;
          igSession.clearCache(username);
          const infoa = await check(username);
          if (!infoa) return; // network error � skip this tick
          if (infoa.banned) {
            clearInterval(intv); activeWatches.delete(`ban_${username}`);
            await db.updateStatus(username, 'banned'); await db.logEvent(username, 'banned');
            const alertCh = channel.guild ? await getAlertChannel(channel.guild, 'ban') : channel;
            await sendBannedEmbed(alertCh || channel, username, formatTimeTaken(startTime), null, acc.followers, null, null, null);
            await notifyDmUsers(username, `${EM.ban} **@${username}** has been banned!`);
          }
        } catch (err) {
          await db.incrementFail(username);
          const a = await db.getAccount(username);
          if (a && a.failCount >= 5) { clearInterval(intv); activeWatches.delete(`ban_${username}`); }
        }
      }, checkInterval);
      activeWatches.set(`ban_${username}`, intv);
    } else {
      let sent = false;
      const intv = setInterval(async () => {
        try {
          if (pausedWatches.has(`unban_${username}`)) return;
          igSession.clearCache(username);
          const infoa = await check(username);
          if (!infoa) return; // network error � skip this tick
          if (!infoa.banned && !sent) {
            sent = true; clearInterval(intv); activeWatches.delete(`unban_${username}`);
            if (infoa.followers) await db.updateFollowers(username, infoa.followers);
            await db.removeAccount(username); await db.logEvent(username, 'recovered');
            const alertCh = channel.guild ? await getAlertChannel(channel.guild, 'unban') : channel;
            await sendRecoveredEmbed(alertCh || channel, username, infoa.followers, infoa.following, formatTimeTaken(startTime), infoa.profilePic, infoa.posts, infoa.bio);
            await notifyDmUsers(username, `${EM.unban} **@${username}** has been recovered!`);
          }
        } catch (err) {
          await db.incrementFail(username);
          const a = await db.getAccount(username);
          if (a && a.failCount >= 5) { clearInterval(intv); activeWatches.delete(`unban_${username}`); }
        }
      }, checkInterval);
      activeWatches.set(`unban_${username}`, intv);
    }
  }

  // Follower tracking interval
  setInterval(async () => {    try {
      const tracks = await db.getFollowerTracks();
      for (const track of tracks) {
        try {
          igSession.clearCache(track.username);
          const info = await check(track.username);
          if (!info || !info.followers) continue;
          const current = parseInt(info.followers), previous = track.followers;
          const diff = Math.abs(current - previous);
          if (diff >= track.threshold) {
            const ch = await client.channels.fetch(track.channelId).catch(() => null);
            if (ch) {
              const dir = current > previous ? '📈' : '📉';
              await ch.send({ embeds: [new EmbedBuilder().setTitle(`${dir} Follower Change | @${track.username}`).setDescription(`**${fmtNum(previous)}** → **${fmtNum(current)}** (${current > previous ? '+' : ''}${fmtNum(current - previous)})`).setColor(0xFFFFFF)] });
              await db.logEvent(track.username, 'followers_change', `${previous} → ${current}`);
            }
            await db.updateFollowerTrackCount(track.username, current);
          }
        } catch (_) {}
      }
    } catch (_) {}
  }, checkInterval);

  // ── Verify tracking interval ────────────────────────────────────────────────
  setInterval(async () => {
    try {
      const tracks = await db.getVerifyTracks();
      for (const track of tracks) {
        try {
          igSession.clearCache(track.username);
          const info = await check(track.username);
          if (!info) continue; // network error — skip
          if (info.isVerified) {
            // Account got verified!
            await db.removeVerifyTrack(track.username);
            await db.logEvent(track.username, 'verified', 'Account got verified');

            // Get verify alert channel
            let alertCh = null;
            if (channelConfig.verifyChannelId) {
              alertCh = await client.channels.fetch(channelConfig.verifyChannelId).catch(() => null);
            }
            if (!alertCh) {
              alertCh = await client.channels.fetch(track.channelId).catch(() => null);
            }
            if (!alertCh) continue;

            const pingText = channelConfig.pingRoleId ? `<@&${channelConfig.pingRoleId}> ` : '';
            await alertCh.send(
              `${pingText}Account Verified | ${track.username} ✅🔵\n` +
              `${EM.time} Time taken: ${formatTimeTaken(new Date(track.startTime).getTime())}`
            );

            // Send screenshot with blue tick
            const buf = await takeScreenshot(track.username, info.followers, info.following, info.profilePic, info.posts, info.bio, true);
            if (buf) {
              const att   = new AttachmentBuilder(buf, { name: `${track.username}_verified.png` });
              const embed = new EmbedBuilder().setColor(0xFFFFFF).setImage(`attachment://${track.username}_verified.png`);
              await alertCh.send({ embeds: [embed], files: [att] });
            }

            await notifyDmUsers(track.username, `✅🔵 **@${track.username}** got verified!`);
          }
        } catch (_) {}
      }
    } catch (_) {}
  }, checkInterval);
});

// ─── Message Handler ──────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const isOwner   = OWNER_IDS.includes(message.author.id);
  const isAllowed = isOwner || allowedUserIds.includes(message.author.id);

  const hasPrefix = message.content.startsWith(PREFIX);

  // If no prefix — only owners and premium users can proceed
  if (!hasPrefix) {
    if (!isOwner) {
      const isPremium = await db.isPremium(message.author.id);
      if (!isPremium) return;
    }
    // Make sure it looks like a command word (not random chat)
    if (!message.content.match(/^\w/)) return;
  }

  const content = hasPrefix
    ? message.content.slice(PREFIX.length).trim()
    : message.content.trim();

  if (!content) return;

  const args    = content.split(/\s+/);
  const command = args[0].toLowerCase();
  const rest    = args.slice(1);

  console.log(`[cmd] user=${message.author.id} isOwner=${isOwner} guild=${message.guild?.id} cmd=${command}`);

  // Maintenance mode — only owners can use commands
  if (MAINTENANCE && !isOwner) {
    return message.channel.send({ embeds: [
      new EmbedBuilder()
        .setTitle(' Bot Under Maintenance')
        .setDescription('The bot is currently under maintenance.\nPlease try again later.')
        .setColor(0xFFA500)
        .setFooter({ text: 'We\'ll be back soon!' })
    ]});
  }

  // Guild access check — owners bypass always, DMs bypass
  if (message.guild && !isOwner) {
    const guildOk = await db.hasGuildAccess(message.guild.id);
    console.log(`[cmd] guildAccess=${guildOk} for ${message.guild.id}`);
    if (!guildOk) {
      // Allow guildaccess command even without access so owner can authorize
      if (command !== 'guildaccess') return;
    }
  }

  // ── mon / moff — maintenance mode ────────────────────────────────────────────
  if (command === 'mon') {
    if (!isOwner) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Owner Only').setDescription('Only bot owners can use this.').setColor(0xFFFFFF)] });
    MAINTENANCE = true;
    // Update bot status to show maintenance
    client.user.setPresence({
      status: 'dnd',
      activities: [{ name: ' Under Maintenance', type: 4 }]
    });
    return message.channel.send({ embeds: [
      new EmbedBuilder()
        .setTitle(' Maintenance Mode ON')
        .setDescription('Bot is now in maintenance mode.\nOnly owners can use commands.\n\nUse `,moff` to turn off.')
        .setColor(0xFFA500)
    ]});
  }

  else if (command === 'moff') {
    if (!isOwner) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Owner Only').setDescription('Only bot owners can use this.').setColor(0xFFFFFF)] });
    MAINTENANCE = false;
    // Restore normal status
    client.user.setPresence({
      status: 'online',
      activities: [{ name: 'Instagram Monitor', type: 3 }]
    });
    return message.channel.send({ embeds: [
      new EmbedBuilder()
        .setTitle(' Maintenance Mode OFF')
        .setDescription('Bot is back online!\nAll commands are now available.')
        .setColor(0x00FF7F)
    ]});
  }

  // ── guildaccess ───────────────────────────────────────────────────────────────
  else if (command === 'guildaccess') {
    return require('./commands/guildaccess')({ message, rest, db, client, OWNER_IDS, PREFIX });
  }

  // ── invite ────────────────────────────────────────────────────────────────────
  else if (command === 'invite') {
    return require('./commands/invite')({ message, client, PREFIX });
  }

  // ── givepremium ───────────────────────────────────────────────────────────────
  else if (command === 'givepremium') {
    return require('./commands/premium')({ message, rest, db, client, OWNER_IDS, PREFIX });
  }

  // ── noprefix ──────────────────────────────────────────────────────────────────
  else if (command === 'noprefix') {
    return require('./commands/noprefix')({ message, rest, db, client, OWNER_IDS, PREFIX });
  }

  // ── price ─────────────────────────────────────────────────────────────────────
  else if (command === 'price') {
    return require('./commands/price')({ message });
  }

  // ── nick ──────────────────────────────────────────────────────────────────────
  else if (command === 'nick') {
    return require('./commands/nick')({ message, rest, OWNER_IDS, allowedUserIds });
  }

  // ── pfp ───────────────────────────────────────────────────────────────────────
  else if (command === 'pfp') {
    return require('./commands/pfp')({ message, rest, client, OWNER_IDS, PREFIX });
  }

  // ── setstatus ─────────────────────────────────────────────────────────────────
  else if (command === 'setstatus') {
    return require('./commands/setstatus')({ message, rest, client, OWNER_IDS, PREFIX });
  }

  // ── update ────────────────────────────────────────────────────────────────────
  else if (command === 'update') {
    return require('./commands/update')({ message, rest, db, client, OWNER_IDS, PREFIX });
  }

  // ── serverlist ────────────────────────────────────────────────────────────────
  else if (command === 'serverlist') {
    return require('./commands/serverlist')({ message, client, OWNER_IDS });
  }

  // ── serverinfo ────────────────────────────────────────────────────────────────
  else if (command === 'serverinfo') {
    return require('./commands/serverinfo')({ message, db });
  }

  // ── watchstats ────────────────────────────────────────────────────────────────
  else if (command === 'watchstats') {
    return require('./commands/watchstats')({ message, db, activeWatches, BOT_START });
  }

  // ── top ───────────────────────────────────────────────────────────────────────
  else if (command === 'top') {
    return require('./commands/top')({ message, db });
  }

  // ── owner ─────────────────────────────────────────────────────────────────────
  else if (command === 'owner') {
    return require('./commands/owner')({ message, client, OWNER_IDS });
  }

  // ── setchannel ────────────────────────────────────────────────────────────────
  else if (command === 'setchannel') {
    if (!allowedUserIds.includes(message.author.id)) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Access Denied').setDescription('No permission.').setColor(0xFFFFFF)] });
    const type = rest[0]?.toLowerCase();
    if (!type || !['ban', 'unban', 'verify'].includes(type)) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Invalid').setDescription(`Usage: \`${PREFIX}setchannel ban/unban/verify\``).setColor(0xFFFFFF)] });
    if (type === 'ban')    channelConfig.banChannelId    = message.channel.id;
    else if (type === 'unban')  channelConfig.unbanChannelId  = message.channel.id;
    else if (type === 'verify') channelConfig.verifyChannelId = message.channel.id;
    saveChannels();
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('✅ Channel Set').setDescription(`This channel → **${type} alerts**.`).setColor(0xFFFFFF)] });
  }

  // ── setping ───────────────────────────────────────────────────────────────────
  else if (command === 'setping') {
    if (!allowedUserIds.includes(message.author.id)) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Access Denied').setDescription('No permission.').setColor(0xFFFFFF)] });
    const roleId = rest[0]?.replace(/[<@&>]/g, '');
    if (!roleId) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Role').setDescription(`Usage: \`${PREFIX}setping @role\``).setColor(0xFFFFFF)] });
    channelConfig.pingRoleId = roleId;
    saveChannels();
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('✅ Ping Role Set').setDescription(`<@&${roleId}> will be pinged on alerts.`).setColor(0xFFFFFF)] });
  }

  // ── prefix ────────────────────────────────────────────────────────────────────
  else if (command === 'prefix') {
    if (!allowedUserIds.includes(message.author.id)) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Access Denied').setDescription('No permission.').setColor(0xFFFFFF)] });
    const newPrefix = rest[0];
    if (!newPrefix || newPrefix.length > 3) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Invalid Prefix').setDescription('Prefix must be 1-3 characters.').setColor(0xFFFFFF)] });
    PREFIX = newPrefix;
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('✅ Prefix Updated').setDescription(`New prefix: \`${PREFIX}\``).setColor(0xFFFFFF)] });
  }

  // ── interval ──────────────────────────────────────────────────────────────────
  else if (command === 'interval') {
    if (!allowedUserIds.includes(message.author.id)) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Access Denied').setDescription('No permission.').setColor(0xFFFFFF)] });
    const secs = parseInt(rest[0]);
    if (!secs || secs < 30) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Invalid').setDescription('Minimum 30 seconds.\nUsage: `,interval <seconds>`').setColor(0xFFFFFF)] });
    checkInterval = secs * 1000;
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('✅ Interval Updated').setDescription(`Check interval: **${secs}s**\n⚠️ Applies to new watches only.`).setColor(0xFFFFFF)] });
  }

  // ── watch ─────────────────────────────────────────────────────────────────────
  else if (command === 'watch') {
    const username = rest[0]?.toLowerCase();
    if (!username) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Username').setDescription(`Usage: \`${PREFIX}watch <username>\``).setColor(0xFFFFFF)] });
    if (await db.isBlacklisted(username)) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('🚫 Blacklisted').setDescription(`**@${username}** is blacklisted.`).setColor(0xFFFFFF)] });

    if (activeWatches.has(`ban_${username}`) || activeWatches.has(`unban_${username}`)) {
      return message.channel.send({ embeds: [new EmbedBuilder().setTitle('👀 Already Watching').setDescription(`**@${username}** is already being watched.`).setColor(0xFFFFFF)] });
    }

    const checking = await message.channel.send({ embeds: [new EmbedBuilder().setDescription(`${EM.load} Checking **@${username}**...`).setColor(0xFFFFFF)] });
    let info = await check(username);
    // If first result says banned, wait 4s and verify once more to avoid false positives
    if (info && info.banned) {
      await new Promise(r => setTimeout(r, 4000));
      igSession.clearCache(username);
      const info2 = await check(username);
      if (info2) info = info2; // use the fresher result
    }
    const startTime = Date.now();
    await checking.delete().catch(() => {});

    if (!info) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Error').setDescription(`Could not fetch **@${username}**. Instagram may be blocking requests. Try again.`).setColor(0xFFFFFF)] });

    if (!info.banned) {
      await db.addAccount(username, message.channel.id, 'active', info.followers, message.guild?.id);
      await message.channel.send({ embeds: [
        new EmbedBuilder()
          .setTitle(`${EM.eye} Monitoring @${username}`)
          .setDescription(`Will notify here when **banned** ${EM.ban}\n\n**Followers:** ${fmtNum(info.followers)} · **Following:** ${fmtNum(info.following)}\n${EM.active} Active · Started ${formatTimestamp(new Date())}`)
          .setColor(0xFFFFFF)
          .setFooter({ text: `Checking every ${checkInterval / 1000}s` })
      ]});

      const intv = setInterval(async () => {
        try {
          igSession.clearCache(username);
          const infoa = await check(username);
          if (!infoa) return; // network error � skip this tick
          if (infoa.banned) {
            clearInterval(intv); activeWatches.delete(`ban_${username}`);
            await db.updateStatus(username, 'banned');
            await db.logEvent(username, 'banned');
            const alertCh = message.guild ? await getAlertChannel(message.guild, 'ban') : message.channel;
            await sendBannedEmbed(alertCh || message.channel, username, formatTimeTaken(startTime), info.profilePic, info.followers, info.following, info.posts, info.bio);
          }
        } catch (err) {
          await db.incrementFail(username);
          const acc = await db.getAccount(username);
          if (acc && acc.failCount >= 5) { clearInterval(intv); activeWatches.delete(`ban_${username}`); }
        }
      }, checkInterval);
      activeWatches.set(`ban_${username}`, intv);

    } else {
      await db.addAccount(username, message.channel.id, 'banned', null, message.guild?.id);
      await message.channel.send({ embeds: [
        new EmbedBuilder()
          .setTitle(`${EM.eye} Monitoring @${username}`)
          .setDescription(`Will notify here when **recovered** ${EM.unban}\n\n${EM.banned} Currently Banned · Started ${formatTimestamp(new Date())}`)
          .setColor(0xFFFFFF)
          .setFooter({ text: `Checking every ${checkInterval / 1000}s` })
      ]});

      let sent = false;
      const intv = setInterval(async () => {
        try {
          igSession.clearCache(username);
          const infoa = await check(username);
          if (!infoa) return; // network error � skip this tick
          if (!infoa.banned && !sent) {
            sent = true; clearInterval(intv); activeWatches.delete(`unban_${username}`);
            if (infoa.followers) await db.updateFollowers(username, infoa.followers);
            await db.removeAccount(username);
            await db.logEvent(username, 'recovered');
            const alertCh = message.guild ? await getAlertChannel(message.guild, 'unban') : message.channel;
            await sendRecoveredEmbed(alertCh || message.channel, username, infoa.followers, infoa.following, formatTimeTaken(startTime), infoa.profilePic, infoa.posts, infoa.bio);
          }
        } catch (err) {
          await db.incrementFail(username);
          const acc = await db.getAccount(username);
          if (acc && acc.failCount >= 5) { clearInterval(intv); activeWatches.delete(`unban_${username}`); }
        }
      }, checkInterval);
      activeWatches.set(`unban_${username}`, intv);
    }
  }

  // ── banwatch ──────────────────────────────────────────────────────────────────
  else if (command === 'banwatch') {
    const username = rest[0]?.toLowerCase();
    if (!username) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Username').setDescription(`Usage: \`${PREFIX}banwatch <username>\``).setColor(0xFFFFFF)] });
    if (activeWatches.has(`ban_${username}`)) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('👀 Already Watching').setDescription(`**@${username}** already on ban list.`).setColor(0xFFFFFF)] });

    const checking = await message.channel.send({ embeds: [new EmbedBuilder().setDescription(`${EM.load} Checking **@${username}**...`).setColor(0xFFFFFF)] });
    const info      = await check(username);
    const startTime = Date.now();
    await checking.delete().catch(() => {});

    if (!info) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Error').setDescription(`Could not fetch **@${username}**. Try again.`).setColor(0xFFFFFF)] });

    if (info.banned) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Already Banned').setDescription(`Use \`${PREFIX}unbanwatch ${username}\` instead.`).setColor(0xFFFFFF)] });

    await db.addAccount(username, message.channel.id, 'active', info.followers, message.guild?.id);
    await message.channel.send({ embeds: [
      new EmbedBuilder()
        .setTitle(`${EM.eye} Monitoring @${username}`)
        .setDescription(`Will notify here when **banned** ${EM.ban}\n\n**Followers:** ${fmtNum(info.followers)} · **Following:** ${fmtNum(info.following)}\n${EM.active} Active · Started ${formatTimestamp(new Date())}`)
        .setColor(0xFFFFFF)
        .setFooter({ text: `Checking every ${checkInterval / 1000}s` })
    ]});

    const intv = setInterval(async () => {
      try {
        igSession.clearCache(username);
        const infoa = await check(username);
        if (!infoa) return; // network error � skip this tick
        if (infoa.banned) {
          clearInterval(intv); activeWatches.delete(`ban_${username}`);
          await db.updateStatus(username, 'banned');
          await db.logEvent(username, 'banned');
          const alertCh = message.guild ? await getAlertChannel(message.guild, 'ban') : message.channel;
          await sendBannedEmbed(alertCh || message.channel, username, formatTimeTaken(startTime), info.profilePic, info.followers, info.following, info.posts, info.bio);
        }
      } catch (err) {
        await db.incrementFail(username);
        const acc = await db.getAccount(username);
        if (acc && acc.failCount >= 5) { clearInterval(intv); activeWatches.delete(`ban_${username}`); }
      }
    }, checkInterval);
    activeWatches.set(`ban_${username}`, intv);
  }

  // ── unbanwatch ────────────────────────────────────────────────────────────────
  else if (command === 'unbanwatch') {
    const username = rest[0]?.toLowerCase();
    if (!username) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Username').setDescription(`Usage: \`${PREFIX}unbanwatch <username>\``).setColor(0xFFFFFF)] });
    if (activeWatches.has(`unban_${username}`)) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('👀 Already Watching').setDescription(`**@${username}** already on unban list.`).setColor(0xFFFFFF)] });

    const checking = await message.channel.send({ embeds: [new EmbedBuilder().setDescription(`${EM.load} Checking **@${username}**...`).setColor(0xFFFFFF)] });
    const info      = await check(username);
    const startTime = Date.now();
    await checking.delete().catch(() => {});

    if (!info) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Error').setDescription(`Could not fetch **@${username}**. Try again.`).setColor(0xFFFFFF)] });

    if (!info.banned) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Not Banned').setDescription(`Use \`${PREFIX}banwatch ${username}\` instead.`).setColor(0xFFFFFF)] });

    await db.addAccount(username, message.channel.id, 'banned', null, message.guild?.id);
    await message.channel.send({ embeds: [
      new EmbedBuilder()
        .setTitle(`${EM.eye} Monitoring @${username}`)
        .setDescription(`Will notify here when **recovered** ${EM.unban}\n\n${EM.banned} Currently Banned · Started ${formatTimestamp(new Date())}`)
        .setColor(0xFFFFFF)
        .setFooter({ text: `Checking every ${checkInterval / 1000}s` })
    ]});

    let sent = false;
    const intv = setInterval(async () => {
      try {
        igSession.clearCache(username);
        const infoa = await check(username);
        if (!infoa) return; // network error � skip this tick
        if (!infoa.banned && !sent) {
          sent = true; clearInterval(intv); activeWatches.delete(`unban_${username}`);
          if (infoa.followers) await db.updateFollowers(username, infoa.followers);
          await db.removeAccount(username);
          await db.logEvent(username, 'recovered');
          const alertCh = message.guild ? await getAlertChannel(message.guild, 'unban') : message.channel;
          await sendRecoveredEmbed(alertCh || message.channel, username, infoa.followers, infoa.following, formatTimeTaken(startTime), infoa.profilePic, infoa.posts, infoa.bio);
        }
      } catch (err) {
        await db.incrementFail(username);
        const acc = await db.getAccount(username);
        if (acc && acc.failCount >= 5) { clearInterval(intv); activeWatches.delete(`unban_${username}`); }
      }
    }, checkInterval);
    activeWatches.set(`unban_${username}`, intv);
  }

  // ── unwatch ───────────────────────────────────────────────────────────────────
  else if (command === 'unwatch') {
    const username = rest[0]?.toLowerCase();
    if (!username) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Username').setDescription(`Usage: \`${PREFIX}unwatch <username>\``).setColor(0xFFFFFF)] });

    const banKey = `ban_${username}`, unbanKey = `unban_${username}`;
    const wasBan = activeWatches.has(banKey), wasUnban = activeWatches.has(unbanKey);

    if (!wasBan && !wasUnban) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Not Watching').setDescription(`**@${username}** is not being watched.`).setColor(0xFFFFFF)] });

    if (wasBan)   { clearInterval(activeWatches.get(banKey));   activeWatches.delete(banKey); }
    if (wasUnban) { clearInterval(activeWatches.get(unbanKey)); activeWatches.delete(unbanKey); }
    await db.removeAccount(username);

    return message.channel.send({ embeds: [new EmbedBuilder().setTitle(`🛑 Stopped | @${username}`).setDescription(`Watch stopped.`).setColor(0xFFFFFF)] });
  }

  // ── clearlist ─────────────────────────────────────────────────────────────────
  else if (command === 'clearlist') {
    if (!allowedUserIds.includes(message.author.id)) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Access Denied').setDescription('No permission.').setColor(0xFFFFFF)] });
    let count = 0;
    for (const [key, intv] of activeWatches) {
      clearInterval(intv);
      activeWatches.delete(key);
      count++;
    }
    const accounts = await db.getAccounts();
    for (const acc of accounts) await db.removeAccount(acc.username);
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('🗑️ Cleared').setDescription(`Stopped **${count}** watches and cleared DB.`).setColor(0xFFFFFF)] });
  }

  // ── banlist ───────────────────────────────────────────────────────────────────
  else if (command === 'banlist') {
    const list = await db.getBanWatchList();
    return message.channel.send({ embeds: [
      new EmbedBuilder()
        .setTitle(' Ban Watch List')
        .setDescription(list.length ? list.map((a, i) => `\`${i + 1}.\` @${a.username}`).join('\n') : '*Empty*')
        .setColor(0xFFFFFF)
        .setFooter({ text: `${list.length} account${list.length !== 1 ? 's' : ''}` })
    ]});
  }

  // ── unbanlist ─────────────────────────────────────────────────────────────────
  else if (command === 'unbanlist') {
    const list = await db.getUnbanWatchList();
    return message.channel.send({ embeds: [
      new EmbedBuilder()
        .setTitle(' Unban Watch List')
        .setDescription(list.length ? list.map((a, i) => `\`${i + 1}.\` @${a.username}`).join('\n') : '*Empty*')
        .setColor(0xFFFFFF)
        .setFooter({ text: `${list.length} account${list.length !== 1 ? 's' : ''}` })
    ]});
  }

  // ── watchlist — both lists in one embed ───────────────────────────────────────
  else if (command === 'watchlist') {
    const banList   = await db.getBanWatchList();
    const unbanList = await db.getUnbanWatchList();
    return message.channel.send({ embeds: [
      new EmbedBuilder()
        .setTitle('📋 Watch List')
        .addFields(
          { name: `${EM.active} Ban Watch (${banList.length})`,   value: banList.length   ? banList.map(a   => `• @${a.username}`).join('\n') : '*Empty*', inline: true },
          { name: `${EM.banned} Unban Watch (${unbanList.length})`, value: unbanList.length ? unbanList.map(a => `• @${a.username}`).join('\n') : '*Empty*', inline: true }
        )
        .setColor(0xFFFFFF)
        .setFooter({ text: `Total: ${banList.length + unbanList.length}` })
    ]});
  }

  // ── status ────────────────────────────────────────────────────────────────────
  else if (command === 'status') {
    const username = rest[0]?.toLowerCase();
    if (!username) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Username').setDescription(`Usage: \`${PREFIX}status <username>\``).setColor(0xFFFFFF)] });

    const checking = await message.channel.send({ embeds: [new EmbedBuilder().setDescription(`${EM.load} Checking **@${username}**...`).setColor(0xFFFFFF)] });
    const info = await check(username);
    await checking.delete().catch(() => {});

    if (!info) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Error').setDescription(`Could not fetch **@${username}**. Try again.`).setColor(0xFFFFFF)] });

    const acc = await db.getAccount(username);
    const watching = activeWatches.has(`ban_${username}`) || activeWatches.has(`unban_${username}`);

    return message.channel.send({ embeds: [
      new EmbedBuilder()
        .setTitle(`📊 Status | @${username}`)
        .setDescription(
          `**Status:** ${info.banned ? ' Banned' : ' Active'}\n` +
          `**Followers:** ${fmtNum(info.followers)} · **Following:** ${fmtNum(info.following)} · **Posts:** ${fmtNum(info.posts)}\n` +
          `**Watching:** ${watching ? '✅ Yes' : '❌ No'}` +
          (acc ? `\n**Since:** ${formatTimestamp(new Date(acc.startTime))}` : '')
        )
        .setColor(0xFFFFFF)
    ]});
  }

  // ── check — info + screenshot, no watch ──────────────────────────────────────
  else if (command === 'check') {
    const username = rest[0]?.toLowerCase();
    if (!username) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Username').setDescription(`Usage: \`${PREFIX}check <username>\``).setColor(0xFFFFFF)] });

    const loading = await message.channel.send({ embeds: [new EmbedBuilder().setDescription(`${EM.load} Fetching **@${username}**...`).setColor(0xFFFFFF)] });
    const info    = await check(username);
    await loading.delete().catch(() => {});

    if (!info) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Error').setDescription(`Could not fetch **@${username}**. Instagram may be blocking. Try again.`).setColor(0xFFFFFF)] });

    if (info.banned) {
      return message.channel.send({ embeds: [new EmbedBuilder().setTitle(`${EM.banned} Banned | @${username}`).setDescription('This account is currently banned.').setColor(0xFFFFFF)] });
    }

    await message.channel.send(
      `@${username} · ${fmtNum(info.followers)} followers · ${fmtNum(info.following)} following · ${fmtNum(info.posts)} posts`
    );
    const buf = await takeScreenshot(username, info.followers, info.following, info.profilePic, info.posts, info.bio);
    if (buf) {
      const att   = new AttachmentBuilder(buf, { name: `${username}.png` });
      const embed = new EmbedBuilder().setColor(0xFFFFFF).setImage(`attachment://${username}.png`);
      return message.channel.send({ embeds: [embed], files: [att] });
    }
  }

  // ── stats ─────────────────────────────────────────────────────────────────────
  else if (command === 'stats') {
    const s = await db.getStats();
    return message.channel.send({ embeds: [
      new EmbedBuilder()
        .setTitle('📈 Bot Stats')
        .setDescription(
          `**Currently Watching:** ${s.totalWatched}\n` +
          `**Total Banned:** ${s.totalBanned}\n` +
          `**Total Recovered:** ${s.totalRecovered}\n` +
          `**Active Intervals:** ${activeWatches.size}\n` +
          `**Check Interval:** ${checkInterval / 1000}s\n` +
          `**Prefix:** \`${PREFIX}\``
        )
        .setColor(0xFFFFFF)
    ]});
  }

  // ── watchtime ─────────────────────────────────────────────────────────────────
  else if (command === 'watchtime') {
    const username = rest[0]?.toLowerCase();
    if (!username) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Username').setDescription(`Usage: \`${PREFIX}watchtime <username>\``).setColor(0xFFFFFF)] });

    const acc = await db.getAccount(username);
    if (!acc) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Not Found').setDescription(`**@${username}** is not being watched.`).setColor(0xFFFFFF)] });

    const elapsed = formatTimeTaken(new Date(acc.startTime).getTime());
    return message.channel.send({ embeds: [
      new EmbedBuilder()
        .setTitle(`⏱️ Watch Time | @${username}`)
        .setDescription(`Watching for **${elapsed}**\nStarted: ${formatTimestamp(new Date(acc.startTime))}`)
        .setColor(0xFFFFFF)
    ]});
  }

  // ── retry ─────────────────────────────────────────────────────────────────────
  else if (command === 'retry') {
    const username = rest[0]?.toLowerCase();
    if (!username) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Username').setDescription(`Usage: \`${PREFIX}retry <username>\``).setColor(0xFFFFFF)] });
    const acc = await db.getAccount(username);
    if (!acc) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Not Found').setDescription(`**@${username}** not in DB.`).setColor(0xFFFFFF)] });
    await db.resetFail(username);
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('🔄 Reset').setDescription(`Fail count reset for **@${username}**.`).setColor(0xFFFFFF)] });
  }

  else if (command === 'help') {
    return require('./commands/help')({ message, client, PREFIX, isOwner, checkInterval });
  }

  // ── verifywatch ───────────────────────────────────────────────────────────────
  else if (command === 'verifywatch') {
    const username = rest[0]?.toLowerCase();
    if (!username) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Username').setDescription(`Usage: \`${PREFIX}verifywatch <username>\``).setColor(0xFFFFFF)] });

    // Check if already watching
    const existing = await db.getVerifyTrack(username);
    if (existing) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('👀 Already Watching').setDescription(`**@${username}** is already on verify watch.`).setColor(0xFFFFFF)] });

    const checking = await message.channel.send({ embeds: [new EmbedBuilder().setDescription(`${EM.load} Checking **@${username}**...`).setColor(0xFFFFFF)] });
    const info = await check(username);
    await checking.delete().catch(() => {});

    if (!info) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Error').setDescription('Could not fetch account. Try again.').setColor(0xFFFFFF)] });

    // Already verified — don't add
    if (info.isVerified) {
      return message.channel.send({ embeds: [
        new EmbedBuilder()
          .setTitle('✅ Already Verified')
          .setDescription(`**@${username}** is already verified. No need to watch.`)
          .setColor(0xFFFFFF)
      ]});
    }

    // Account doesn't exist / banned
    if (info.banned) {
      return message.channel.send({ embeds: [
        new EmbedBuilder()
          .setTitle('❌ Account Banned/Not Found')
          .setDescription(`**@${username}** is banned or doesn't exist.`)
          .setColor(0xFFFFFF)
      ]});
    }

    await db.addVerifyTrack(username, message.channel.id, message.guild?.id);
    return message.channel.send({ embeds: [
      new EmbedBuilder()
        .setTitle(`🔵 Verify Watch | @${username}`)
        .setDescription(
          `**${fmtNum(info.followers)}** followers · **${fmtNum(info.following)}** following\n` +
          `🔵 Not verified · Started ${formatTimestamp(new Date())}`
        )
        .setColor(0xFFFFFF)
        .setFooter({ text: `Every ${checkInterval / 1000}s` })
    ]});
  }

  // ── unverifywatch ─────────────────────────────────────────────────────────────
  else if (command === 'unverifywatch') {
    const username = rest[0]?.toLowerCase();
    if (!username) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Username').setDescription(`Usage: \`${PREFIX}unverifywatch <username>\``).setColor(0xFFFFFF)] });
    const existing = await db.getVerifyTrack(username);
    if (!existing) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Not Watching').setDescription(`**@${username}** is not on verify watch.`).setColor(0xFFFFFF)] });
    await db.removeVerifyTrack(username);
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('🛑 Stopped').setDescription(`Verify watch for **@${username}** stopped.`).setColor(0xFFFFFF)] });
  }

  // ── verifylist ────────────────────────────────────────────────────────────────
  else if (command === 'verifylist') {
    const list = await db.getVerifyTracks();
    return message.channel.send({ embeds: [
      new EmbedBuilder()
        .setTitle('🔵 Verify Watch List')
        .setDescription(list.length ? list.map((a, i) => `\`${i + 1}.\` @${a.username}`).join('\n') : '*Empty*')
        .setColor(0xFFFFFF)
        .setFooter({ text: `${list.length} account${list.length !== 1 ? 's' : ''}` })
    ]});
  }



  // ── multiwatch ────────────────────────────────────────────────────────────────
  else if (command === 'multiwatch') {
    if (rest.length === 0) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Usernames').setDescription(`Usage: \`${PREFIX}multiwatch user1 user2 user3\``).setColor(0xFFFFFF)] });
    const results = [];
    for (const u of rest) {
      const username = u.toLowerCase();
      if (await db.isBlacklisted(username)) { results.push(`❌ @${username} — blacklisted`); continue; }
      if (activeWatches.has(`ban_${username}`) || activeWatches.has(`unban_${username}`)) { results.push(`👀 @${username} — already watching`); continue; }
      const info = await check(username);
      if (!info) { results.push(`❌ @${username} — fetch failed, try again`); continue; }
      if (!info.banned) {
        await db.addAccount(username, message.channel.id, 'active', info.followers, message.guild?.id);
        const startTime = Date.now();
        const intv = setInterval(async () => {
          try {
            if (pausedWatches.has(`ban_${username}`)) return;
            igSession.clearCache(username);
            const infoa = await check(username);
            if (!infoa) return; // network error � skip this tick
            if (infoa.banned) {
              clearInterval(intv); activeWatches.delete(`ban_${username}`);
              await db.updateStatus(username, 'banned'); await db.logEvent(username, 'banned');
              const alertCh = message.guild ? await getAlertChannel(message.guild, 'ban') : message.channel;
              await sendBannedEmbed(alertCh || message.channel, username, formatTimeTaken(startTime), info.profilePic, info.followers, info.following, info.posts, info.bio);
              await notifyDmUsers(username, `${EM.ban} **@${username}** has been banned!`);
            }
          } catch (err) { await db.incrementFail(username); }
        }, checkInterval);
        activeWatches.set(`ban_${username}`, intv);
        results.push(`${EM.active} @${username} — ban watch started`);
      } else {
        await db.addAccount(username, message.channel.id, 'banned', null, message.guild?.id);
        const startTime = Date.now();
        let sent = false;
        const intv = setInterval(async () => {
          try {
            if (pausedWatches.has(`unban_${username}`)) return;
            igSession.clearCache(username);
            const infoa = await check(username);
            if (!infoa) return; // network error � skip this tick
            if (!infoa.banned && !sent) {
              sent = true; clearInterval(intv); activeWatches.delete(`unban_${username}`);
              if (infoa.followers) await db.updateFollowers(username, infoa.followers);
              await db.removeAccount(username); await db.logEvent(username, 'recovered');
              const alertCh = message.guild ? await getAlertChannel(message.guild, 'unban') : message.channel;
              await sendRecoveredEmbed(alertCh || message.channel, username, infoa.followers, infoa.following, formatTimeTaken(startTime), infoa.profilePic, infoa.posts, infoa.bio);
              await notifyDmUsers(username, `${EM.unban} **@${username}** has been recovered!`);
            }
          } catch (err) { await db.incrementFail(username); }
        }, checkInterval);
        activeWatches.set(`unban_${username}`, intv);
        results.push(`${EM.banned} @${username} — unban watch started`);
      }
    }
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle(`${EM.eye} Multi Watch (${rest.length})`).setDescription(results.join('\n')).setColor(0xFFFFFF)] });
  }

  // ── pause / resume ────────────────────────────────────────────────────────────
  else if (command === 'pause') {
    const username = rest[0]?.toLowerCase();
    if (!username) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Username').setDescription(`Usage: \`${PREFIX}pause <username>\``).setColor(0xFFFFFF)] });
    const banKey = `ban_${username}`, unbanKey = `unban_${username}`;
    if (!activeWatches.has(banKey) && !activeWatches.has(unbanKey)) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Not Watching').setDescription(`**@${username}** is not being watched.`).setColor(0xFFFFFF)] });
    pausedWatches.add(banKey); pausedWatches.add(unbanKey);
    await db.setPaused(username, true);
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle(`⏸️ Paused | @${username}`).setDescription('Watch paused. Use `,resume` to continue.').setColor(0xFFFFFF)] });
  }

  else if (command === 'resume') {
    const username = rest[0]?.toLowerCase();
    if (!username) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Username').setDescription(`Usage: \`${PREFIX}resume <username>\``).setColor(0xFFFFFF)] });
    const banKey = `ban_${username}`, unbanKey = `unban_${username}`;
    if (!activeWatches.has(banKey) && !activeWatches.has(unbanKey)) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Not Watching').setDescription(`**@${username}** is not being watched.`).setColor(0xFFFFFF)] });
    pausedWatches.delete(banKey); pausedWatches.delete(unbanKey);
    await db.setPaused(username, false);
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle(`▶️ Resumed | @${username}`).setDescription('Watch resumed.').setColor(0xFFFFFF)] });
  }

  // ── followers ─────────────────────────────────────────────────────────────────
  else if (command === 'followers') {
    const username  = rest[0]?.toLowerCase();
    const threshold = parseInt(rest[1]) || 100;
    if (!username) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Username').setDescription(`Usage: \`${PREFIX}followers <username> [threshold]\``).setColor(0xFFFFFF)] });

    const checking = await message.channel.send({ embeds: [new EmbedBuilder().setDescription(`${EM.load} Checking **@${username}**...`).setColor(0xFFFFFF)] });
    const info = await check(username);
    await checking.delete().catch(() => {});

    if (!info) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Error').setDescription(`Could not fetch **@${username}**. Try again.`).setColor(0xFFFFFF)] });

    await db.addFollowerTrack(username, message.channel.id, info.followers, threshold, message.guild?.id);
    return message.channel.send({ embeds: [
      new EmbedBuilder()
        .setTitle(`📊 Follower Track | @${username}`)
        .setDescription(`Current: **${fmtNum(info.followers)}** followers\nAlert when change ≥ **${threshold}**`)
        .setColor(0xFFFFFF)
    ]});
  }

  // ── dmon / dmoff ──────────────────────────────────────────────────────────────
  else if (command === 'dmon') {
    await db.setDmUser(message.author.id, true);
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('✅ DM Alerts On').setDescription('You will receive DM alerts for ban/unban events.').setColor(0xFFFFFF)] });
  }

  else if (command === 'dmoff') {
    await db.setDmUser(message.author.id, false);
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('🔕 DM Alerts Off').setDescription('DM alerts disabled.').setColor(0xFFFFFF)] });
  }

  // ── history ───────────────────────────────────────────────────────────────────
  else if (command === 'history') {
    const username = rest[0]?.toLowerCase();
    if (!username) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Username').setDescription(`Usage: \`${PREFIX}history <username>\``).setColor(0xFFFFFF)] });
    const events = await db.getHistory(username);
    if (!events.length) return message.channel.send({ embeds: [new EmbedBuilder().setTitle(`📜 History | @${username}`).setDescription('No history found.').setColor(0xFFFFFF)] });
    const lines = events.map(e => `${formatTimestamp(new Date(e.timestamp))} — **${e.event}**${e.detail ? ` (${e.detail})` : ''}`);
    return message.channel.send({ embeds: [
      new EmbedBuilder()
        .setTitle(`📜 History | @${username}`)
        .setDescription(lines.join('\n'))
        .setColor(0xFFFFFF)
        .setFooter({ text: `Last ${events.length} events` })
    ]});
  }

  // ── logs ──────────────────────────────────────────────────────────────────────
  else if (command === 'logs') {
    const events = await db.getLogs();
    if (!events.length) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('📋 Recent Logs').setDescription('No events yet.').setColor(0xFFFFFF)] });
    const lines = events.map(e => `${formatTimestamp(new Date(e.timestamp))} — **@${e.username}** ${e.event}${e.detail ? ` (${e.detail})` : ''}`);
    return message.channel.send({ embeds: [
      new EmbedBuilder()
        .setTitle('📋 Recent Logs')
        .setDescription(lines.join('\n'))
        .setColor(0xFFFFFF)
        .setFooter({ text: 'Last 10 events' })
    ]});
  }

  // ── export ────────────────────────────────────────────────────────────────────
  else if (command === 'export') {
    const accounts = await db.getAccounts();
    if (!accounts.length) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('📤 Export').setDescription('Nothing to export.').setColor(0xFFFFFF)] });
    const csv = ['username,status,followers,startTime,channelId',
      ...accounts.map(a => `${a.username},${a.lastStatus},${a.followers},${a.startTime?.toISOString()},${a.channelId}`)
    ].join('\n');
    const att = new AttachmentBuilder(Buffer.from(csv), { name: 'watchlist.csv' });
    return message.channel.send({ content: '📤 Watchlist export:', files: [att] });
  }

  // ── ping ──────────────────────────────────────────────────────────────────────
  else if (command === 'ping') {
    const start = Date.now();
    const msg   = await message.channel.send({ embeds: [new EmbedBuilder().setDescription('🏓 Pinging...').setColor(0xFFFFFF)] });
    await msg.edit({ embeds: [new EmbedBuilder().setTitle('🏓 Pong!').setDescription(`Latency: **${Date.now() - start}ms**\nWS: **${client.ws.ping}ms**`).setColor(0xFFFFFF)] });
  }

  // ── uptime ────────────────────────────────────────────────────────────────────
  else if (command === 'uptime') {
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('⏱️ Uptime').setDescription(`Bot running for **${formatTimeTaken(BOT_START)}**`).setColor(0xFFFFFF)] });
  }

  // ── botinfo ───────────────────────────────────────────────────────────────────
  else if (command === 'botinfo') {
    const s = await db.getStats();
    return message.channel.send({ embeds: [
      new EmbedBuilder()
        .setTitle('🤖 Bot Info')
        .setDescription(
          `**Version:** 2.0.0\n` +
          `**Uptime:** ${formatTimeTaken(BOT_START)}\n` +
          `**Prefix:** \`${PREFIX}\`\n` +
          `**Interval:** ${checkInterval / 1000}s\n` +
          `**Active Watches:** ${activeWatches.size}\n` +
          `**Total Watched:** ${s.totalWatched}\n` +
          `**Total Banned:** ${s.totalBanned}\n` +
          `**Total Recovered:** ${s.totalRecovered}`
        )
        .setColor(0xFFFFFF)
    ]});
  }

  // ── remind ────────────────────────────────────────────────────────────────────
  else if (command === 'remind') {
    const username = rest[0]?.toLowerCase();
    const timeStr  = rest[1];
    if (!username || !timeStr) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Args').setDescription(`Usage: \`${PREFIX}remind <username> <time>\`\nTime: 30s, 5m, 2h`).setColor(0xFFFFFF)] });

    const match = timeStr.match(/^(\d+)(s|m|h)$/);
    if (!match) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Invalid Time').setDescription('Use format: `30s`, `5m`, `2h`').setColor(0xFFFFFF)] });

    const mult = { s: 1000, m: 60000, h: 3600000 };
    const ms   = parseInt(match[1]) * mult[match[2]];

    await message.channel.send({ embeds: [new EmbedBuilder().setDescription(`⏰ Will check **@${username}** in **${timeStr}**`).setColor(0xFFFFFF)] });

    setTimeout(async () => {
      const info = await check(username);
      if (!info) {
        return message.channel.send({ embeds: [new EmbedBuilder().setTitle(`⏰ Reminder | @${username}`).setDescription('Could not fetch account status. Try again.').setColor(0xFFFFFF)] });
      }
      await message.channel.send({ embeds: [
        new EmbedBuilder()
          .setTitle(`⏰ Reminder | @${username}`)
          .setDescription(
            `**Status:** ${info.banned ? ' Banned' : ' Active'}\n` +
            `**Followers:** ${fmtNum(info.followers)} · **Following:** ${fmtNum(info.following)}`
          )
          .setColor(0xFFFFFF)
      ]});
    }, ms);
  }

  // ── removeaccess ──────────────────────────────────────────────────────────────
  else if (command === 'removeaccess') {
    if (!allowedUserIds.includes(message.author.id)) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Access Denied').setDescription('No permission.').setColor(0xFFFFFF)] });
    const uid = rest[0];
    if (!uid) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing ID').setDescription(`Usage: \`${PREFIX}removeaccess <id>\``).setColor(0xFFFFFF)] });
    const idx = allowedUserIds.indexOf(uid);
    if (idx === -1) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Not Found').setDescription(`<@${uid}> does not have access.`).setColor(0xFFFFFF)] });
    allowedUserIds.splice(idx, 1);
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('✅ Access Removed').setDescription(`<@${uid}> access revoked.`).setColor(0xFFFFFF)] });
  }

  // ── accesslist ────────────────────────────────────────────────────────────────
  else if (command === 'accesslist') {
    if (!allowedUserIds.includes(message.author.id)) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Access Denied').setDescription('No permission.').setColor(0xFFFFFF)] });
    return message.channel.send({ embeds: [
      new EmbedBuilder()
        .setTitle('👥 Access List')
        .setDescription(allowedUserIds.length ? allowedUserIds.map(id => `<@${id}>`).join('\n') : '*No users*')
        .setColor(0xFFFFFF)
        .setFooter({ text: `${allowedUserIds.length} user${allowedUserIds.length !== 1 ? 's' : ''}` })
    ]});
  }

  // ── blacklist ─────────────────────────────────────────────────────────────────
  else if (command === 'blacklist') {
    if (!allowedUserIds.includes(message.author.id)) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Access Denied').setDescription('No permission.').setColor(0xFFFFFF)] });
    const sub      = rest[0]?.toLowerCase();
    const username = rest[1]?.toLowerCase();
    if (sub === 'add' && username) {
      await db.addBlacklist(username);
      return message.channel.send({ embeds: [new EmbedBuilder().setTitle('🚫 Blacklisted').setDescription(`**@${username}** added to blacklist.`).setColor(0xFFFFFF)] });
    } else if (sub === 'remove' && username) {
      await db.removeBlacklist(username);
      return message.channel.send({ embeds: [new EmbedBuilder().setTitle('✅ Removed').setDescription(`**@${username}** removed from blacklist.`).setColor(0xFFFFFF)] });
    } else if (sub === 'list') {
      const list = await db.getBlacklist();
      return message.channel.send({ embeds: [new EmbedBuilder().setTitle('🚫 Blacklist').setDescription(list.length ? list.map(b => `• @${b.username}`).join('\n') : '*Empty*').setColor(0xFFFFFF)] });
    } else {
      return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Invalid').setDescription(`Usage:\n\`${PREFIX}blacklist add <user>\`\n\`${PREFIX}blacklist remove <user>\`\n\`${PREFIX}blacklist list\``).setColor(0xFFFFFF)] });
    }
  }

// ─── Login ────────────────────────────────────────────────────────────────────
});

module.exports = { start: () => client.login(TOKEN) };


