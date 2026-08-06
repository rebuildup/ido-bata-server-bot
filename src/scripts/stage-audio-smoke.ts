import "dotenv/config";

import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import { ChannelType, Client, Events, GatewayIntentBits } from "discord.js";

import { timekeeperConfig } from "../features/timekeeper/config.js";
import { buildTimekeeperTimeline } from "../features/timekeeper/timeline.js";
import { attachVoiceDebugging, logVoiceStateSnapshot } from "../features/timekeeper/voice-debug.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`stage-audio-smoke ready as ${readyClient.user.tag}`);

  const channel = await readyClient.channels.fetch(timekeeperConfig.voiceChannelId);
  if (!channel?.isVoiceBased()) {
    throw new Error("Configured channel is not voice-based");
  }

  const connection = joinVoiceChannel({
    guildId: channel.guild.id,
    channelId: channel.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play },
  });
  attachVoiceDebugging(connection, player);
  connection.subscribe(player);
  await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

  if (channel.type === ChannelType.GuildStageVoice) {
    const me = await channel.guild.members.fetch(readyClient.user.id);
    await me.voice.setSuppressed(false).catch(() => undefined);
    await logVoiceStateSnapshot(me, channel, "smoke-after-unsuppress");
  }

  const first = buildTimekeeperTimeline(new Date())[0];
  if (!first) {
    throw new Error("No audio plan entry");
  }

  console.log(`smoke-playing ${first.audioPath}`);
  player.play(createAudioResource(first.audioPath));
  await entersState(player, AudioPlayerStatus.Playing, 30_000);
  await entersState(player, AudioPlayerStatus.Idle, 60_000);
  connection.destroy();
  await client.destroy();
});

client.login(process.env.DISCORD_TOKEN);
