import type { Balance } from "../shared/balance";
import type { GameEvent } from "../shared/types";

export interface Recap {
  /** One-line summary for Claude Code. Names at least one settler per event type. */
  line: string;
  events: GameEvent[];
}

/**
 * "While you were gone": non-null only when away longer than
 * balance.recapAwaySeconds AND new island events exist since lastSeen.
 */
export function computeRecap(
  feed: GameEvent[],
  lastSeen: number,
  now: number,
  balance: Balance,
): Recap | null {
  if (now - lastSeen <= balance.recapAwaySeconds) return null;
  const events = feed.filter((e) => e.at > lastSeen && e.at <= now);
  if (events.length === 0) return null;

  const byType = new Map<string, GameEvent[]>();
  for (const e of events) {
    const bucket = byType.get(e.type) ?? [];
    bucket.push(e);
    byType.set(e.type, bucket);
  }
  const parts: string[] = [];
  for (const [type, bucket] of byType) {
    const named = bucket.find((e) => e.settler);
    const label = type.replace(/-/g, " ");
    if (named) {
      const extra = bucket.length > 1 ? ` (and ${bucket.length - 1} more)` : "";
      parts.push(`${label}: ${named.settler}${extra}`);
    } else {
      parts.push(`${label} ×${bucket.length}`);
    }
  }
  return { line: `While you were gone — ${parts.join("; ")}.`, events };
}
