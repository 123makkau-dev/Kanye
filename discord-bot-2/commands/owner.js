const { EmbedBuilder } = require('discord.js');

module.exports = async ({ message, client, OWNER_IDS }) => {
  const isOwner = OWNER_IDS.includes(message.author.id);
  if (!isOwner) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Access Denied').setDescription('Owner only.').setColor(0xFFFFFF)] });

  const owners = OWNER_IDS.map(id => `<@${id}>`).join('\n') || '*None set*';

  return message.channel.send({ embeds: [
    new EmbedBuilder()
      .setTitle('👑 Bot Owners')
      .setDescription(owners)
      .setFooter({ text: `${client.guilds.cache.size} servers · ${client.users.cache.size} users cached` })
      .setColor(0xFFFFFF)
  ]});
};
