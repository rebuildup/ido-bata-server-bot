import { Client, GatewayIntentBits, Partials } from "discord.js";

export function createDiscordClient(options?: { enableMessageContentIntent?: boolean }): Client {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
  ];

  if (options?.enableMessageContentIntent) {
    intents.push(GatewayIntentBits.MessageContent);
  }

  return new Client({
    intents,
    partials: [Partials.Channel, Partials.Message, Partials.Reaction],
  });
}
