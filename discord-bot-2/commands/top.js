const { EmbedBuilder } = require('discord.js');

module.exports = async ({ message, db }) => {
  const logs = await db.getLogs(); // recent stat events
  // count bans per username from available logs
  const counts = {};
  for (const s of logs) {
    if (s.event === 'banned') counts[s.username] = (counts[s.username] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  if (!sorted.length) {
    const stats = await db.getStats();
    return message.channel.send({ embeds: [
      new EmbedBuilder()
        .setTitle('🏆 Ban Stats')
        .setDescription(`**Total bans recorded:** ${stats.totalBanned}\n**Total recoveries:** ${stats.totalRecovered}\n\nNo per-account breakdown available yet.`)
        .setColor(0xFFFFFF)
    ]});
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = sorted.map(([u, c], i) => `${medals[i] || `**${i + 1}.**`} @${u} — **${c}** ban${c !== 1 ? 's' : ''}`);

  return message.channel.send({ embeds: [
    new EmbedBuilder()
      .setTitle('🏆 Top Banned Accounts')
      .setDescription(lines.join('\n'))
      .setColor(0xFFFFFF)
  ]});
};
