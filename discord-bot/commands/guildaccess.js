const { EmbedBuilder } = require('discord.js');

module.exports = async ({ message, rest, db, client, OWNER_IDS, PREFIX }) => {
  const isOwner = OWNER_IDS.includes(message.author.id);
  if (!isOwner) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Access Denied').setDescription('Owner only.').setColor(0xFFFFFF)] });

  const sub = rest[0]?.toLowerCase();
  const guildId = rest[1];

  if (sub === 'add') {
    if (!guildId) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing ID').setDescription(`Usage: \`${PREFIX}guildaccess add <guild_id>\``).setColor(0xFFFFFF)] });
    const guild = client.guilds.cache.get(guildId);
    await db.addGuildAccess(guildId, guild?.name || 'Unknown', message.author.id, null);
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('✅ Access Granted').setDescription(`Server \`${guildId}\` (${guild?.name || 'Unknown'}) now has access.`).setColor(0xFFFFFF)] });
  }

  if (sub === 'remove') {
    if (!guildId) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing ID').setDescription(`Usage: \`${PREFIX}guildaccess remove <guild_id>\``).setColor(0xFFFFFF)] });
    await db.removeGuildAccess(guildId);
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('✅ Access Removed').setDescription(`Server \`${guildId}\` access revoked.`).setColor(0xFFFFFF)] });
  }

  if (sub === 'list') {
    const list = await db.getGuildAccessList();
    if (!list.length) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('📋 Guild Access List').setDescription('*No servers authorized.*').setColor(0xFFFFFF)] });
    const lines = list.map(g => {
      const exp = g.expiresAt ? ` (expires ${g.expiresAt.toDateString()})` : ' (permanent)';
      return `\`${g.guildId}\` — ${g.guildName || 'Unknown'}${exp}`;
    });
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle(`📋 Guild Access List (${list.length})`).setDescription(lines.join('\n')).setColor(0xFFFFFF)] });
  }

  return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Invalid').setDescription(`Usage: \`${PREFIX}guildaccess add/remove/list <guild_id>\``).setColor(0xFFFFFF)] });
};
