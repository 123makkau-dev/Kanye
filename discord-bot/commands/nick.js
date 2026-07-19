const { EmbedBuilder } = require('discord.js');

module.exports = async ({ message, rest, OWNER_IDS, allowedUserIds }) => {
  const isOwner = OWNER_IDS.includes(message.author.id);
  if (!isOwner) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Access Denied').setDescription('Owner only.').setColor(0xFFFFFF)] });

  const nick = rest.join(' ');
  if (!nick) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Name').setDescription('Provide a nickname.').setColor(0xFFFFFF)] });

  try {
    await message.guild?.members.me?.setNickname(nick);
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('✅ Nickname Changed').setDescription(`Bot nickname set to **${nick}**`).setColor(0xFFFFFF)] });
  } catch (e) {
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Error').setDescription(`Failed: ${e.message}`).setColor(0xFFFFFF)] });
  }
};
