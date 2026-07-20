const { EmbedBuilder } = require('discord.js');

module.exports = async ({ message, client, OWNER_IDS }) => {
  const isOwner = OWNER_IDS.includes(message.author.id);
  if (!isOwner) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Access Denied').setDescription('Owner only.').setColor(0xFFFFFF)] });

  const guilds = client.guilds.cache;
  const lines = guilds.map(g => `\`${g.id}\` — **${g.name}** (${g.memberCount} members)`);

  const chunks = [];
  for (let i = 0; i < lines.length; i += 20) chunks.push(lines.slice(i, i + 20));

  for (const chunk of chunks) {
    await message.channel.send({ embeds: [
      new EmbedBuilder()
        .setTitle(`🌐 Server List (${guilds.size} total)`)
        .setDescription(chunk.join('\n'))
        .setColor(0xFFFFFF)
    ]});
  }
};
