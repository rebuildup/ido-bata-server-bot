import { readdirSync } from "node:fs";
import { join } from "node:path";

import { type TimekeeperConfig, type TimekeeperPhase, timekeeperConfig } from "./config.js";

const audioDir = join(process.cwd(), "tmp-audio");

export type TimekeeperEventKind =
  | "break-start"
  | "phase-ending-soon"
  | "phase-start"
  | "session-end"
  | "work-start-soon";

export type TimekeeperTimelineEvent = {
  at: Date;
  audioPath: string;
  durationMinutes: number | null;
  endAt: Date | null;
  kind: TimekeeperEventKind;
  label: string;
  order: number;
  sendText: boolean;
  stepIndex: number;
  totalSteps: number;
};

export function buildTimekeeperTimeline(
  startAt: Date,
  config: TimekeeperConfig = timekeeperConfig,
): TimekeeperTimelineEvent[] {
  const audioFiles = listAudioFiles();
  const phases = config.phases;
  const totalSteps = phases.length;

  const work1Start = new Date(startAt);
  const break1Start = addMinutes(work1Start, phases[0]?.durationMinutes ?? 0);
  const work2Start = addMinutes(break1Start, phases[1]?.durationMinutes ?? 0);
  const break2Start = addMinutes(work2Start, phases[2]?.durationMinutes ?? 0);
  const work3Start = addMinutes(break2Start, phases[3]?.durationMinutes ?? 0);
  const sessionEnd = addMinutes(work3Start, phases[4]?.durationMinutes ?? 0);

  return [
    createTimelineEvent(
      audioFiles,
      1,
      "work-start-soon",
      phases[0],
      addMinutes(work1Start, -1),
      1,
      totalSteps,
    ),
    createTimelineEvent(audioFiles, 2, "phase-start", phases[0], work1Start, 1, totalSteps),
    createTimelineEvent(
      audioFiles,
      3,
      "phase-ending-soon",
      phases[0],
      addMinutes(break1Start, -1),
      1,
      totalSteps,
    ),
    createTimelineEvent(audioFiles, 4, "break-start", phases[1], break1Start, 2, totalSteps),
    createTimelineEvent(
      audioFiles,
      5,
      "work-start-soon",
      phases[2],
      addMinutes(work2Start, -1),
      3,
      totalSteps,
    ),
    createTimelineEvent(audioFiles, 6, "phase-start", phases[2], work2Start, 3, totalSteps),
    createTimelineEvent(
      audioFiles,
      7,
      "phase-ending-soon",
      phases[2],
      addMinutes(break2Start, -1),
      3,
      totalSteps,
    ),
    createTimelineEvent(audioFiles, 8, "break-start", phases[3], break2Start, 4, totalSteps),
    createTimelineEvent(
      audioFiles,
      9,
      "work-start-soon",
      phases[4],
      addMinutes(work3Start, -1),
      5,
      totalSteps,
    ),
    createTimelineEvent(audioFiles, 10, "phase-start", phases[4], work3Start, 5, totalSteps),
    createTimelineEvent(
      audioFiles,
      11,
      "phase-ending-soon",
      phases[4],
      addMinutes(sessionEnd, -1),
      5,
      totalSteps,
    ),
    createTimelineEvent(audioFiles, 12, "session-end", phases[4], sessionEnd, 5, totalSteps),
  ];
}

export function buildProgressMessage(
  event: TimekeeperTimelineEvent,
  now: Date,
  participantCount: number,
): string | null {
  if (!event.sendText) {
    return null;
  }

  const elapsedMinutes = getElapsedMinutes(event, now);
  const remainingMinutes = Math.max(0, (event.durationMinutes ?? 0) - elapsedMinutes);
  const totalMinutes = event.durationMinutes ?? 0;
  const bar = buildProgressBar(elapsedMinutes, totalMinutes);
  const progressMinutes = `${padMinutes(elapsedMinutes)}/${padMinutes(totalMinutes)}分`;
  const remainingText = remainingMinutes === 0 ? "終了" : `${remainingMinutes}分`;

  return [
    `## ${event.label} (${event.durationMinutes}分)`,
    `終了予定: ${event.endAt ? `${formatJstTime(event.endAt)}まで` : "-"}`,
    `進捗: [${bar}] ${progressMinutes}`,
    `確認済み: ${participantCount}人`,
    `残り: ${remainingText}`,
  ].join("\n");
}

function createTimelineEvent(
  audioFiles: Map<number, string>,
  order: number,
  kind: TimekeeperEventKind,
  phase: TimekeeperPhase | undefined,
  at: Date,
  stepIndex: number,
  totalSteps: number,
): TimekeeperTimelineEvent {
  if (!phase) {
    throw new Error(`Missing phase definition for order ${order}`);
  }

  const audioPath = audioFiles.get(order);

  if (!audioPath) {
    throw new Error(`Missing audio file for order ${order}`);
  }

  const sendText = kind === "phase-start" || kind === "break-start";
  const endAt =
    kind === "phase-start" || kind === "break-start" ? addMinutes(at, phase.durationMinutes) : null;

  return {
    at,
    audioPath,
    durationMinutes: phase.durationMinutes,
    endAt,
    kind,
    label: phase.label,
    order,
    sendText,
    stepIndex,
    totalSteps,
  };
}

function listAudioFiles(): Map<number, string> {
  const entries = readdirSync(audioDir)
    .filter((entry) => /^\d{3}_/.test(entry))
    .sort((left, right) => left.localeCompare(right, "ja"))
    .map((entry) => [Number.parseInt(entry.slice(0, 3), 10), join(audioDir, entry)] as const);

  return new Map(entries);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function formatJstTime(date: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function getElapsedMinutes(event: TimekeeperTimelineEvent, now: Date): number {
  if (!event.durationMinutes || !event.endAt) {
    return 0;
  }

  const elapsedMs = Math.max(0, now.getTime() - event.at.getTime());
  return Math.min(event.durationMinutes, Math.floor(elapsedMs / 60_000));
}

function buildProgressBar(elapsedMinutes: number, totalMinutes: number): string {
  const width = 12;

  if (totalMinutes <= 0) {
    return "=".repeat(width);
  }

  const filled = Math.min(width, Math.floor((elapsedMinutes / totalMinutes) * width));
  return `${"+".repeat(filled)}${"=".repeat(width - filled)}`;
}

function padMinutes(value: number): string {
  return value.toString().padStart(2, "0");
}
