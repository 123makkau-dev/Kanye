const { EmbedBuilder } = require('discord.js');

module.exports = async ({ message, rest, db, client, OWNER_IDS, PREFIX }) => {
  const isOwner = OWNER_IDS.includes(message.author.id);
  if (!isOwner) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Access Denied').setDescription('Owner only.').setColor(0xFFFFFF)] });

  const sub = rest[0]?.toLowerCase();
  const userId = rest[1];

  if (sub === 'add') {
    if (!userId) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing ID').setDescription(`Usage: \`${PREFIX}givepremium add <user_id>\``).setColor(0xFFFFFF)] });
    await db.addPremium(userId, message.guild?.id, message.author.id, null);
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('⭐ Premium Granted').setDescription(`<@${userId}> is now a premium user.`).setColor(0xFFFFFF)] });
  }

  if (sub === 'remove') {
    if (!userId) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing ID').setDescription(`Usage: \`${PREFIX}givepremium remove <user_id>\``).setColor(0xFFFFFF)] });
    await db.removePremium(userId);
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('✅ Premium Removed').setDescription(`<@${userId}> is no longer premium.`).setColor(0xFFFFFF)] });
  }

  if (sub === 'list') {
    const list = await db.getPremiumList();
    if (!list.length) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('⭐ Premium Users').setDescription('*No premium users.*').setColor(0xFFFFFF)] });
    const lines = list.map(u => {
      const exp = u.expiresAt ? ` (expires ${u.expiresAt.toDateString()})` : ' (permanent)';
      return `<@${u.userId}>${exp}`;
    });
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle(`⭐ Premium Users (${list.length})`).setDescription(lines.join('\n')).setColor(0xFFFFFF)] });
  }

  return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Invalid').setDescription(`Usage: \`${PREFIX}givepremium add/remove/list <user_id>\``).setColor(0xFFFFFF)] });
};
