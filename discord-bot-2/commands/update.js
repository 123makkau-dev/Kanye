const { EmbedBuilder } = require('discord.js');

module.exports = async ({ message, rest, db, client, OWNER_IDS, PREFIX }) => {
  const isOwner = OWNER_IDS.includes(message.author.id);
  if (!isOwner) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Access Denied').setDescription('Owner only.').setColor(0xFFFFFF)] });

  const text = rest.join(' ');
  if (!text) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Message').setDescription(`Usage: \`${PREFIX}update <message>\``).setColor(0xFFFFFF)] });

  const channels = await db.getAllUpdateChannels();
  let sent = 0;

  const embed = new EmbedBuilder()
    .setTitle('📢 Bot Update')
    .setDescription(text)
    .setColor(0xFFFFFF)
    .setTimestamp();

  for (const entry of channels) {
    try {
      const ch = await client.channels.fetch(entry.channelId).catch(() => null);
      if (ch) { await ch.send({ embeds: [embed] }); sent++; }
    } catch (_) {}
  }

  return message.channel.send({ embeds: [new EmbedBuilder().setTitle('✅ Update Sent').setDescription(`Update broadcast to **${sent}** server(s).`).setColor(0xFFFFFF)] });
};
