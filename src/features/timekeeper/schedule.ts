import { timekeeperConfig, type TimekeeperConfig } from "./config.js";

const JST_OFFSET_MINUTES = 9 * 60;

export type TimekeeperAnnouncement = {
  at: Date;
  kind: "ending-soon" | "phase-start";
  phaseLabel: string;
};

export function buildDailyAnnouncements(
  startAt: Date,
  config: TimekeeperConfig = timekeeperConfig,
): TimekeeperAnnouncement[] {
  const announcements: TimekeeperAnnouncement[] = [];
  let cursor = new Date(startAt);

  for (const phase of config.phases) {
    if (phase.label !== "5分休憩") {
      announcements.push({
        at: new Date(cursor.getTime() - 60_000),
        kind: "ending-soon",
        phaseLabel: phase.label,
      });
    }

    announcements.push({
      at: new Date(cursor),
      kind: "phase-start",
      phaseLabel: phase.label,
    });

    const endingSoonAt = new Date(cursor.getTime() + (phase.durationMinutes - 1) * 60_000);
    announcements.push({
      at: endingSoonAt,
      kind: "ending-soon",
      phaseLabel: phase.label,
    });

    cursor = new Date(cursor.getTime() + phase.durationMinutes * 60_000);
  }

  return announcements;
}

export function getNextDailyStartAt(
  now: Date,
  startHourJst: number = timekeeperConfig.startHourJst,
  startMinuteJst: number = timekeeperConfig.startMinuteJst,
): Date {
  const nowJst = new Date(now.getTime() + JST_OFFSET_MINUTES * 60_000);
  const candidateJst = new Date(Date.UTC(
    nowJst.getUTCFullYear(),
    nowJst.getUTCMonth(),
    nowJst.getUTCDate(),
    startHourJst,
    startMinuteJst,
    0,
    0,
  ));

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
  const totalDurationMinutes = phases.reduce(
    (total, phase) => total + phase.durationMinutes,
    0,
  );
  const todaySessionEndAt = new Date(
    todayStartAt.getTime() + totalDurationMinutes * 60_000,
  );

  if (now >= todayStartAt && now < todaySessionEndAt) {
    return todayStartAt;
  }

  return getNextDailyStartAt(now, startHourJst, startMinuteJst);
}

function getDailyStartAt(
  now: Date,
  startHourJst: number,
  startMinuteJst: number,
): Date {
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
