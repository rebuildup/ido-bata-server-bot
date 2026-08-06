import type { AudioPlayer, VoiceConnection } from "@discordjs/voice";
import type { GuildMember, VoiceBasedChannel } from "discord.js";

type JsonRecord = Record<string, unknown>;

export function attachVoiceDebugging(connection: VoiceConnection, player: AudioPlayer): void {
  connection.on("error", (error) => {
    logJson("voice-connection-error", {
      error: error.message,
      status: connection.state.status,
      voicePrivacyCode: connection.voicePrivacyCode ?? null,
      wsPing: connection.ping.ws ?? null,
      udpPing: connection.ping.udp ?? null,
    });
  });

  player.on("error", (error) => {
    logJson("audio-player-error", {
      error: error.message,
      status: player.state.status,
      playableCount: player.playable.length,
    });
  });
}

export async function logVoiceStateSnapshot(
  member: GuildMember,
  channel: VoiceBasedChannel,
  label: string,
): Promise<void> {
  await member.fetch(true);
  logJson("voice-state", {
    label,
    guildId: member.guild.id,
    channelId: member.voice.channelId,
    channelType: channel.type,
    suppress: member.voice.suppress,
    serverMute: member.voice.serverMute,
    selfMute: member.voice.selfMute,
    serverDeaf: member.voice.serverDeaf,
    selfDeaf: member.voice.selfDeaf,
    requestToSpeak: member.voice.requestToSpeakTimestamp,
    sessionId: member.voice.sessionId ?? null,
  });
}

function logJson(event: string, data: JsonRecord): void {
  console.log(
    JSON.stringify({
      event,
      ts: new Date().toISOString(),
      ...data,
    }),
  );
}
