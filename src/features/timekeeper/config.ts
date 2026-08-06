export type TimekeeperPhase = {
  durationMinutes: number;
  label: string;
};

export type TimekeeperConfig = {
  startHourJst: number;
  startMinuteJst: number;
  textChannelId: string;
  voiceChannelId: string;
  phases: TimekeeperPhase[];
};

// Replace these placeholders with real channel IDs and audio files.
export const timekeeperConfig: TimekeeperConfig = {
  startHourJst: 21,
  startMinuteJst: 0,
  textChannelId: "1487974752437141585",
  //textChannelId: "1488896517371858975",
  voiceChannelId: "1487974752437141585",
  //voiceChannelId: "1488896517371858975",
  phases: [
    { label: "作業フェーズ 1", durationMinutes: 15 },
    { label: "5分休憩", durationMinutes: 5 },
    { label: "作業フェーズ 2", durationMinutes: 30 },
    { label: "5分休憩", durationMinutes: 5 },
    { label: "作業フェーズ 3", durationMinutes: 45 },
  ],
};

export function isTimekeeperConfigured(config: TimekeeperConfig): boolean {
  return !config.textChannelId.includes("HERE") && !config.voiceChannelId.includes("HERE");
}
