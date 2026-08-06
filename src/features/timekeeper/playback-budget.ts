/**
 * Announcement playback runs inline in the timekeeper event loop, so any time
 * spent waiting for the audio player is stolen from the gap before the next
 * event. `getDelayFor` is anchored to absolute wall-clock time, so an overrun
 * collapses the next wait to <= 0 and the following event fires immediately.
 *
 * The tightest gap in the timeline is the 1 minute between `phase-ending-soon`
 * and the phase end, so that pair is the first casualty. These helpers bound
 * each announcement to the time actually available before the next event.
 */

export const PLAYBACK_START_TIMEOUT_MS = 8_000;
export const PLAYBACK_FINISH_TIMEOUT_MS = 20_000;
export const PLAYBACK_GUARD_MS = 2_000;

const MIN_TIMEOUT_MS = 250;

export type PlaybackTimeouts = {
  finishTimeoutMs: number;
  startTimeoutMs: number;
};

/**
 * @param msUntilNextEvent Time left before the next timeline event is due, or
 * `null` when this is the final event of the session.
 */
export function resolvePlaybackTimeouts(msUntilNextEvent: number | null): PlaybackTimeouts {
  if (msUntilNextEvent === null) {
    return {
      startTimeoutMs: PLAYBACK_START_TIMEOUT_MS,
      finishTimeoutMs: PLAYBACK_FINISH_TIMEOUT_MS,
    };
  }

  const budgetMs = msUntilNextEvent - PLAYBACK_GUARD_MS;

  if (budgetMs < MIN_TIMEOUT_MS * 2) {
    return { startTimeoutMs: MIN_TIMEOUT_MS, finishTimeoutMs: MIN_TIMEOUT_MS };
  }

  const startTimeoutMs = Math.min(PLAYBACK_START_TIMEOUT_MS, Math.floor(budgetMs / 3));
  const finishTimeoutMs = Math.min(PLAYBACK_FINISH_TIMEOUT_MS, budgetMs - startTimeoutMs);

  return { startTimeoutMs, finishTimeoutMs };
}
