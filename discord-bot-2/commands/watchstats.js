const { EmbedBuilder } = require('discord.js');

module.exports = async ({ message, db, activeWatches, BOT_START }) => {
  const watchlist = await db.getWatchlist();
  const stats = await db.getStats();
  const upMs = Date.now() - BOT_START;
  const upSec = Math.floor(upMs / 1000);
  const h = Math.floor(upSec / 3600);
  const m = Math.floor((upSec % 3600) / 60);
  const s = upSec % 60;
  const uptime = `${h}h ${m}m ${s}s`;

  return message.channel.send({ embeds: [
    new EmbedBuilder()
      .setTitle('📊 Watch Statistics')
      .setDescription(
        `**Total Watched:** ${stats.totalWatched}\n` +
        `**Active Intervals:** ${activeWatches.size}\n` +
        `**Paused:** ${watchlist.filter(a => a.paused).length}\n` +
        `**Total Banned Events:** ${stats.totalBanned}\n` +
        `**Total Recovered Events:** ${stats.totalRecovered}\n` +
        `**Bot Uptime:** ${uptime}`
      )
      .setColor(0xFFFFFF)
  ]});
};
