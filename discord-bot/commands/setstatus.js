const { EmbedBuilder, ActivityType } = require('discord.js');

module.exports = async ({ message, rest, client, OWNER_IDS, PREFIX }) => {
  const isOwner = OWNER_IDS.includes(message.author.id);
  if (!isOwner) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Access Denied').setDescription('Owner only.').setColor(0xFFFFFF)] });

  const typeStr = rest[0]?.toLowerCase();
  const text = rest.slice(1).join(' ');

  if (!typeStr || !text) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Invalid').setDescription(`Usage: \`${PREFIX}setstatus <watching/playing/listening/competing> <text>\``).setColor(0xFFFFFF)] });

  const typeMap = {
    watching: ActivityType.Watching,
    playing: ActivityType.Playing,
    listening: ActivityType.Listening,
    competing: ActivityType.Competing,
  };

  const type = typeMap[typeStr];
  if (!type) return message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Invalid Type').setDescription('Use: watching, playing, listening, competing').setColor(0xFFFFFF)] });

  client.user.setActivity(text, { type });
  return message.channel.send({ embeds: [new EmbedBuilder().setTitle('✅ Status Set').setDescription(`Status: **${typeStr} ${text}**`).setColor(0xFFFFFF)] });
};
