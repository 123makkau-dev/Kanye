const { EmbedBuilder } = require('discord.js');

module.exports = async ({ message, client, PREFIX, isOwner, checkInterval }) => {
  const p = PREFIX;

  const userCmds = [
    `\`${p}watch <user>\` — Monitor an IG account`,
    `\`${p}unwatch <user>\` — Stop monitoring`,
    `\`${p}watchlist\` — List all watched accounts`,
    `\`${p}status <user>\` — Check current IG status`,
    `\`${p}check <user>\` — Manual check + screenshot`,
    `\`${p}banlist\` — List banned accounts`,
    `\`${p}unbanlist\` — List recovered accounts`,
    `\`${p}watchtime <user>\` — Time watching an account`,
    `\`${p}pause <user>\` — Pause watching`,
    `\`${p}resume <user>\` — Resume watching`,
    `\`${p}history <user>\` — Ban/unban history`,
    `\`${p}stats\` — Bot statistics`,
    `\`${p}botinfo\` — Bot information`,
    `\`${p}ping\` — Latency`,
    `\`${p}uptime\` — Bot uptime`,
    `\`${p}remind <user> <time>\` — Reminder check (e.g. 30s, 5m, 2h)`,
    `\`${p}multiwatch <u1> <u2> ...\` — Watch multiple accounts`,
    `\`${p}verifywatch <user>\` — Watch for verify badge`,
    `\`${p}followers <user>\` — Track follower changes`,
    `\`${p}logs\` — Recent events`,
    `\`${p}export\` — Export watchlist`,
    `\`${p}help\` — This menu`,
  ];

  const adminCmds = [
    `\`${p}setchannel ban/unban/verify\` — Set notification channel`,
    `\`${p}setping @role\` — Set ping role`,
    `\`${p}prefix <new>\` — Change prefix`,
    `\`${p}interval <ms>\` — Check interval`,
    `\`${p}blacklist add/remove/list <user>\` — Manage blacklist`,
    `\`${p}clearlist\` — Clear all watched accounts`,
    `\`${p}accesslist\` — View allowed users`,
    `\`${p}removeaccess <id>\` — Remove user access`,
    `\`${p}retry <user>\` — Reset fail count`,
    `\`${p}serverinfo\` — Server info`,
    `\`${p}watchstats\` — Watch statistics`,
    `\`${p}top\` — Top banned accounts`,
    `\`${p}dmon\` / \`${p}dmoff\` — Toggle DM alerts`,
  ];

  const ownerCmds = [
    `\`${p}guildaccess add/remove/list <id>\` — Manage server access`,
    `\`${p}givepremium add/remove/list <id>\` — Manage premium`,
    `\`${p}noprefix on/off <id>\` — Toggle no-prefix`,
    `\`${p}serverlist\` — All servers`,
    `\`${p}setstatus <type> <text>\` — Set bot status`,
    `\`${p}nick <name>\` — Change bot nickname`,
    `\`${p}mon\` / \`${p}moff\` — Maintenance mode`,
    `\`${p}update <msg>\` — Broadcast update`,
    `\`${p}owner\` — Owner info`,
    `\`${p}price\` — Price info`,
    `\`${p}invite\` — Invite link`,
  ];

  const embeds = [
    new EmbedBuilder()
      .setTitle('📋 IG Monitor Bot — Commands')
      .setDescription(userCmds.join('\n'))
      .addFields({ name: '⚙️ Admin Commands', value: adminCmds.join('\n') })
      .setColor(0xFFFFFF)
      .setFooter({ text: `Prefix: ${p} · Interval: ${checkInterval / 1000}s` })
  ];

  if (isOwner) {
    embeds[0].addFields({ name: '👑 Owner Commands', value: ownerCmds.join('\n') });
  }

  return message.channel.send({ embeds });
};
