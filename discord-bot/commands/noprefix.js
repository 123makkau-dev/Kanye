const { EmbedBuilder } = require('discord.js');

module.exports = async ({ message, rest, db, client, OWNER_IDS, PREFIX }) => {
  const isOwner = OWNER_IDS.includes(message.author.id);
  if (!isOwner) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Access Denied').setDescription('Owner only.').setColor(0xFFFFFF)] });

  const sub = rest[0]?.toLowerCase();
  const userId = rest[1];

  if (!sub || !userId) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Invalid').setDescription(`Usage: \`${PREFIX}noprefix on/off <user_id>\``).setColor(0xFFFFFF)] });

  if (sub === 'on') {
    await db.addPremium(userId, message.guild?.id, message.author.id, null);
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('✅ No-Prefix Enabled').setDescription(`<@${userId}> can now use commands without prefix.`).setColor(0xFFFFFF)] });
  }

  if (sub === 'off') {
    await db.removePremium(userId);
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('✅ No-Prefix Disabled').setDescription(`<@${userId}> must now use the prefix.`).setColor(0xFFFFFF)] });
  }

  return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Invalid').setDescription(`Usage: \`${PREFIX}noprefix on/off <user_id>\``).setColor(0xFFFFFF)] });
};
