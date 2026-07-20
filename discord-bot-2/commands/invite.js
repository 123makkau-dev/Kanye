const { EmbedBuilder } = require('discord.js');

module.exports = async ({ message, client, PREFIX }) => {
  const invite = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot`;
  return message.channel.send({ embeds: [
    new EmbedBuilder()
      .setTitle('📨 Invite Link')
      .setDescription(`[Click here to invite the bot](${invite})`)
      .setColor(0xFFFFFF)
  ]});
};
