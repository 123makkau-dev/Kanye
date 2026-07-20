const { EmbedBuilder } = require('discord.js');

module.exports = async ({ message, db }) => {
  const guild = message.guild;
  if (!guild) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ No Guild').setDescription('Use this in a server.').setColor(0xFFFFFF)] });

  const hasAccess = await db.hasGuildAccess(guild.id);
  const allAccounts = await db.getAccounts();
  const guildWatches = allAccounts.filter(a => a.guildId === guild.id);

  return message.channel.send({ embeds: [
    new EmbedBuilder()
      .setTitle(`🏠 ${guild.name}`)
      .setDescription(
        `**ID:** \`${guild.id}\`\n` +
        `**Members:** ${guild.memberCount}\n` +
        `**Access:** ${hasAccess ? '✅ Authorized' : '❌ Not Authorized'}\n` +
        `**Watched Accounts:** ${guildWatches.length}`
      )
      .setThumbnail(guild.iconURL())
      .setColor(0xFFFFFF)
  ]});
};
