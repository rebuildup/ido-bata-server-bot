import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { TimekeeperEventKind } from "./timeline.js";
import { fetchRandomWikipediaTopic, type WikipediaTopic } from "./wikipedia.js";

export type TimekeeperSessionEngagement = {
  attendanceDatesByUserId: Map<string, Set<string>>;
  checkInsByUserId: Map<string, Set<number>>;
  id: string;
};

type PersistedAttendance = Record<string, string[]>;

const historyPath = join(process.cwd(), "data", "timekeeper-history.json");

type FortuneDependencies = {
  fetchRandomTopic?: () => Promise<WikipediaTopic>;
};

export function createSessionEngagement(id: string): TimekeeperSessionEngagement {
  return {
    attendanceDatesByUserId: loadAttendanceHistory(),
    id,
    checkInsByUserId: new Map(),
  };
}

export function buildCheckInCustomId(sessionId: string, order: number): string {
  return `timekeeper:check-in:${sessionId}:${order}`;
}

export function parseCheckInCustomId(
  customId: string,
): { order: number; sessionId: string } | null {
  const match = /^timekeeper:check-in:(.+):(\d+)$/.exec(customId);
  if (!match) {
    return null;
  }

  return {
    sessionId: match[1]!,
    order: Number.parseInt(match[2]!, 10),
  };
}

export function recordCheckIn(
  session: TimekeeperSessionEngagement,
  userId: string,
  order: number,
): boolean {
  const existing = session.checkInsByUserId.get(userId) ?? new Set<number>();
  const beforeSize = existing.size;
  existing.add(order);
  session.checkInsByUserId.set(userId, existing);
  return existing.size !== beforeSize;
}

export function recordAttendance(
  session: TimekeeperSessionEngagement,
  userId: string,
  date: string,
): void {
  const existing = session.attendanceDatesByUserId.get(userId) ?? new Set<string>();
  existing.add(date);
  session.attendanceDatesByUserId.set(userId, existing);
}

export function getSessionCheckInCount(
  session: TimekeeperSessionEngagement,
  order: number,
): number {
  return [...session.checkInsByUserId.values()].filter((orders) => orders.has(order)).length;
}

export function buildCheckInLabel(kind: TimekeeperEventKind): string {
  return kind === "break-start" ? "休憩に入る" : "フェーズを確認";
}

export async function buildFortuneSummary(
  session: TimekeeperSessionEngagement,
  dependencies: FortuneDependencies = {},
  random: () => number = Math.random,
): Promise<string[] | null> {
  const entries = await Promise.all(
    [...session.checkInsByUserId.entries()]
      .sort(([left], [right]) => left.localeCompare(right, "ja"))
      .map(async ([userId, orders]) => {
        const topic = await (dependencies.fetchRandomTopic?.() ?? fetchRandomWikipediaTopic());
      const fortune = pickFortuneText(orders.size, random);
      const streakDays = countStreakDays(session.attendanceDatesByUserId.get(userId) ?? new Set<string>());
      return [
        "## 今日の締めおみくじ",
        `<@${userId}> ${fortune} (参加: ${orders.size}フェーズ / 連続: ${streakDays}日)`,
        `ランダムWikipedia占い: ${topic.url}`,
      ].join("\n");
      }),
  );

  if (entries.length === 0) {
    return null;
  }

  return entries;
}

export function persistSessionAttendance(
  session: TimekeeperSessionEngagement,
  date: string,
): void {
  for (const userId of session.checkInsByUserId.keys()) {
    recordAttendance(session, userId, date);
  }

  const serialized: PersistedAttendance = {};
  for (const [userId, dates] of session.attendanceDatesByUserId.entries()) {
    serialized[userId] = [...dates].sort();
  }

  mkdirSync(dirname(historyPath), { recursive: true });
  writeFileSync(historyPath, JSON.stringify(serialized, null, 2), "utf8");
}

function loadAttendanceHistory(): Map<string, Set<string>> {
  if (!existsSync(historyPath)) {
    return new Map();
  }

  const raw = readFileSync(historyPath, "utf8");
  const parsed = JSON.parse(raw) as PersistedAttendance;
  return new Map(
    Object.entries(parsed).map(([userId, dates]) => [userId, new Set(dates)]),
  );
}

function countStreakDays(dates: Set<string>): number {
  const sorted = [...dates].sort();
  if (sorted.length === 0) {
    return 0;
  }

  let streak = 1;
  for (let index = sorted.length - 1; index > 0; index -= 1) {
    const current = new Date(`${sorted[index]}T00:00:00+09:00`);
    const previous = new Date(`${sorted[index - 1]}T00:00:00+09:00`);
    if (current.getTime() - previous.getTime() === 86_400_000) {
      streak += 1;
      continue;
    }
    break;
  }

  return streak;
}

function pickFortuneText(phaseCount: number, random: () => number): string {
  const tiers = phaseCount >= 3
    ? [
        "かなり乗れています。今日は深掘り向きです。",
        "仕上がりが強い日です。難しい作業も押せます。",
      ]
    : phaseCount === 2
      ? [
          "良い流れをつかめています。次も崩れにくいです。",
          "手が温まっています。この調子で詰められます。",
        ]
      : [
          "まずまず良い流れです。次の一手を丁寧に。",
          "無理のないペースです。次でもう一段上げられます。",
        ];

  return tiers[Math.floor(random() * tiers.length)] ?? tiers[0]!;
}
