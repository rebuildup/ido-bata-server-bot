import { describe, expect, it } from "vitest";

import {
  PLAYBACK_FINISH_TIMEOUT_MS,
  PLAYBACK_GUARD_MS,
  PLAYBACK_START_TIMEOUT_MS,
  resolvePlaybackTimeouts,
} from "../src/features/timekeeper/playback-budget.js";

describe("playback budget", () => {
  it("uses the default timeouts when no event follows", () => {
    expect(resolvePlaybackTimeouts(null)).toEqual({
      startTimeoutMs: PLAYBACK_START_TIMEOUT_MS,
      finishTimeoutMs: PLAYBACK_FINISH_TIMEOUT_MS,
    });
  });

  it("never lets an announcement outlast the 1 minute pre-notice gap", () => {
    const oneMinuteGap = 60_000;
    const { startTimeoutMs, finishTimeoutMs } = resolvePlaybackTimeouts(oneMinuteGap);

    // This is the regression: the old code could block for 30s + 60s = 90s,
    // overrunning the gap and making the phase-end event fire immediately.
    expect(startTimeoutMs + finishTimeoutMs).toBeLessThanOrEqual(oneMinuteGap - PLAYBACK_GUARD_MS);
  });

  it("still allows a full clip to play within the 1 minute gap", () => {
    const longestClipMs = 6_210;
    const { finishTimeoutMs } = resolvePlaybackTimeouts(60_000);

    expect(finishTimeoutMs).toBeGreaterThan(longestClipMs);
  });

  it("keeps announcements inside heavily compressed gaps", () => {
    const compressedGap = 1_000;
    const { startTimeoutMs, finishTimeoutMs } = resolvePlaybackTimeouts(compressedGap);

    expect(startTimeoutMs + finishTimeoutMs).toBeLessThan(compressedGap);
  });

  it("never exceeds the available budget for any gap", () => {
    for (const gap of [0, 250, 1_000, 4_000, 60_000, 120_000, 1_500_000]) {
      const { startTimeoutMs, finishTimeoutMs } = resolvePlaybackTimeouts(gap);
      const total = startTimeoutMs + finishTimeoutMs;

      expect(startTimeoutMs).toBeGreaterThan(0);
      expect(finishTimeoutMs).toBeGreaterThan(0);
      expect(total).toBeLessThanOrEqual(Math.max(500, gap - PLAYBACK_GUARD_MS));
    }
  });
});
