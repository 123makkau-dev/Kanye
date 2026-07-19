const { EmbedBuilder } = require('discord.js');

module.exports = async ({ message, rest, client, OWNER_IDS, PREFIX }) => {
  const isOwner = OWNER_IDS.includes(message.author.id);
  if (!isOwner) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Access Denied').setDescription('Owner only.').setColor(0xFFFFFF)] });

  const url = rest[0] || message.attachments.first()?.url;
  if (!url) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Image').setDescription(`Usage: \`${PREFIX}pfp <url>\` or attach an image.`).setColor(0xFFFFFF)] });

  try {
    await client.user.setAvatar(url);
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('✅ Avatar Updated').setDescription('Bot avatar has been changed.').setColor(0xFFFFFF)] });
  } catch (e) {
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Error').setDescription(`Failed: ${e.message}`).setColor(0xFFFFFF)] });
  }
};
