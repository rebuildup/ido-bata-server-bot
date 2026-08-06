import { timekeeperConfig } from "./config.js";

const JST_OFFSET_MINUTES = 9 * 60;

export function getNextDailyStartAt(
  now: Date,
  startHourJst: number = timekeeperConfig.startHourJst,
  startMinuteJst: number = timekeeperConfig.startMinuteJst,
): Date {
  const nowJst = new Date(now.getTime() + JST_OFFSET_MINUTES * 60_000);
  const candidateJst = new Date(
    Date.UTC(
      nowJst.getUTCFullYear(),
      nowJst.getUTCMonth(),
      nowJst.getUTCDate(),
      startHourJst,
      startMinuteJst,
      0,
      0,
    ),
  );

  if (candidateJst.getTime() <= nowJst.getTime()) {
    candidateJst.setUTCDate(candidateJst.getUTCDate() + 1);
  }

  return new Date(candidateJst.getTime() - JST_OFFSET_MINUTES * 60_000);
}

export function getCurrentOrNextDailyStartAt(
  now: Date,
  startHourJst: number = timekeeperConfig.startHourJst,
  startMinuteJst: number = timekeeperConfig.startMinuteJst,
  phases = timekeeperConfig.phases,
): Date {
  const todayStartAt = getDailyStartAt(now, startHourJst, startMinuteJst);
  const totalDurationMinutes = phases.reduce((total, phase) => total + phase.durationMinutes, 0);
  const todaySessionEndAt = new Date(todayStartAt.getTime() + totalDurationMinutes * 60_000);

  if (now >= todayStartAt && now < todaySessionEndAt) {
    return todayStartAt;
  }

  return getNextDailyStartAt(now, startHourJst, startMinuteJst);
}

function getDailyStartAt(now: Date, startHourJst: number, startMinuteJst: number): Date {
  const nowJst = new Date(now.getTime() + JST_OFFSET_MINUTES * 60_000);
  const todayStartJst = new Date(
    Date.UTC(
      nowJst.getUTCFullYear(),
      nowJst.getUTCMonth(),
      nowJst.getUTCDate(),
      startHourJst,
      startMinuteJst,
      0,
      0,
    ),
  );

  return new Date(todayStartJst.getTime() - JST_OFFSET_MINUTES * 60_000);
}
