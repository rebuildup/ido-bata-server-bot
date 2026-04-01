import type { AudioPlayer, VoiceConnection } from "@discordjs/voice";
import { AudioPlayerStatus } from "@discordjs/voice";
import type { GuildMember, VoiceBasedChannel } from "discord.js";

type JsonRecord = Record<string, unknown>;

export function attachVoiceDebugging(
  connection: VoiceConnection,
  player: AudioPlayer,
): void {
  connection.on("stateChange", (oldState, newState) => {
    logJson("voice-connection-state", {
      oldStatus: oldState.status,
      newStatus: newState.status,
      subscription: "subscription" in connection.state ? Boolean(connection.state.subscription) : false,
      voicePrivacyCode: connection.voicePrivacyCode ?? null,
      wsPing: connection.ping.ws ?? null,
      udpPing: connection.ping.udp ?? null,
      rejoinAttempts: connection.rejoinAttempts,
    });
  });

  connection.on("error", (error) => {
    logJson("voice-connection-error", {
      error: error.message,
      status: connection.state.status,
      voicePrivacyCode: connection.voicePrivacyCode ?? null,
      wsPing: connection.ping.ws ?? null,
      udpPing: connection.ping.udp ?? null,
    });
  });

  player.on("stateChange", (oldState, newState) => {
    logJson("audio-player-state", {
      oldStatus: oldState.status,
      newStatus: newState.status,
      playableCount: player.playable.length,
      checkPlayable: player.checkPlayable(),
      resourceReadable: hasReadableResource(newState),
    });
  });

  player.on("error", (error) => {
    logJson("audio-player-error", {
      error: error.message,
      status: player.state.status,
      playableCount: player.playable.length,
    });
  });

  instrumentInternalMethods(connection, player);
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

function instrumentInternalMethods(
  connection: VoiceConnection,
  player: AudioPlayer,
): void {
  const anyConnection = connection as VoiceConnection & {
    dispatchAudio?: () => boolean;
    prepareAudioPacket?: (packet: Buffer) => Buffer | undefined;
    setSpeaking?: (value: boolean) => void;
    __dispatchCount?: number;
    __prepareCount?: number;
  };

  if (typeof anyConnection.prepareAudioPacket === "function") {
    const originalPrepare = anyConnection.prepareAudioPacket.bind(anyConnection);
    anyConnection.prepareAudioPacket = (packet: Buffer) => {
      anyConnection.__prepareCount = (anyConnection.__prepareCount ?? 0) + 1;
      const result = originalPrepare(packet);
      logJson("voice-prepare-audio-packet", {
        count: anyConnection.__prepareCount,
        packetBytes: packet.length,
        result: result === undefined ? "undefined" : "ok",
        connectionStatus: connection.state.status,
        playerStatus: player.state.status,
      });
      return result;
    };
  }

  if (typeof anyConnection.dispatchAudio === "function") {
    const originalDispatch = anyConnection.dispatchAudio.bind(anyConnection);
    anyConnection.dispatchAudio = () => {
      anyConnection.__dispatchCount = (anyConnection.__dispatchCount ?? 0) + 1;
      const result = originalDispatch() ?? false;
      logJson("voice-dispatch-audio", {
        count: anyConnection.__dispatchCount,
        result,
        connectionStatus: connection.state.status,
        playerStatus: player.state.status,
      });
      return result;
    };
  }

  if (typeof anyConnection.setSpeaking === "function") {
    const originalSetSpeaking = anyConnection.setSpeaking.bind(anyConnection);
    anyConnection.setSpeaking = (value: boolean) => {
      logJson("voice-set-speaking", {
        value,
        connectionStatus: connection.state.status,
        playerStatus: player.state.status,
      });
      return originalSetSpeaking(value);
    };
  }
}

function hasReadableResource(state: { status: string }): boolean | null {
  if (
    state.status !== AudioPlayerStatus.Playing &&
    state.status !== AudioPlayerStatus.Buffering &&
    state.status !== AudioPlayerStatus.AutoPaused &&
    state.status !== AudioPlayerStatus.Paused
  ) {
    return null;
  }

  const resource = (state as { resource?: { readable?: boolean } }).resource;
  return resource?.readable ?? null;
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
