import type { Balance } from "./balance";
import type { Pulse } from "./types";

/**
 * Visible-event count + work energy for a completed prompt.
 * Contract: result.events >= balance.inspirationFloor always (never zero);
 * monotone non-decreasing in tokens; diminishing within the rolling window,
 * but the fatigue factor never drops below MIN_FACTOR — junk pays less and
 * less, never nothing.
 */
export interface Inspiration {
  events: number;
  workPoints: number;
}

/** Window tokens at which fatigue reaches half strength. */
const FATIGUE_HALFWAY = 500_000;
const MIN_FACTOR = 0.2;

export function computeInspiration(
  tokens: number,
  history: Pulse[],
  time: number,
  balance: Balance,
): Inspiration {
  const windowStart = time - balance.inspirationWindowSeconds;
  let windowTokens = 0;
  for (const p of history) {
    if (p.time > windowStart && p.time <= time) windowTokens += p.tokens;
  }
  const fatigue = windowTokens / (windowTokens + FATIGUE_HALFWAY);
  const factor = Math.max(MIN_FACTOR, 1 - (1 - MIN_FACTOR) * fatigue);

  const workPoints = tokens * balance.workPointsPerToken * factor;
  const bonus = Math.floor(Math.log10(1 + tokens / 500) * factor);
  const events = Math.min(5, balance.inspirationFloor + bonus);
  return { events: Math.max(balance.inspirationFloor, events), workPoints };
}
