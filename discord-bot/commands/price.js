const { EmbedBuilder } = require('discord.js');

module.exports = async ({ message }) => {
  return message.channel.send({ embeds: [
    new EmbedBuilder()
      .setTitle('💰 Pricing')
      .setDescription(
        '**Premium Access**\n' +
        '• No-prefix commands\n' +
        '• DM notifications\n' +
        '• Priority support\n\n' +
        'Contact the bot owner for pricing details.'
      )
      .setColor(0xFFFFFF)
  ]});
};
