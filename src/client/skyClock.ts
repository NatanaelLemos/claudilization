import { DEFAULT_BALANCE } from "../shared/balance";
import { dayPhase } from "../shared/daylight";

/**
 * The viewer's read of the world clock.
 *
 * The sky is never a stored state that something advances, pauses, or
 * re-seeds: it is a *projection* of the server's world time onto the local
 * monotonic clock. Anchor once (`sync`), then every frame asks `phase()` and
 * gets the true time of day. Nothing a viewer does — focusing another island,
 * peeking across the map, remounting the scene, reconnecting the socket — can
 * touch it, because none of those carry a clock.
 */
export interface SkyClock {
  /** Anchor to the server's world time (seconds) and day length. */
  sync(worldSeconds: number, daySeconds: number): void;
  /** Where the world stands in its day right now, 0 (dawn) → 1 (next dawn). */
  phase(): number;
  /** Seconds of world time as this viewer projects it right now. */
  worldTime(): number;
  /** Pin the sky to a fraction of the day — debugging and screenshots. */
  pin(fraction: number): void;
  /** Release a pin and go back to following the world. */
  unpin(): void;
  /** Whether the world clock has ever been heard from. */
  readonly synced: boolean;
}

/** A backwards jump smaller than this is out-of-order delivery, not a reset. */
const RESET_TOLERANCE_SECONDS = 3600;
/**
 * How far this viewer's projection may run from the server's clock before it
 * snaps back. Small enough that no two spectators can see different times of
 * day, wide enough that the sun is not re-seated on every frame.
 */
const SLEW_TOLERANCE_SECONDS = 1.5;

export function skyClock(now: () => number = () => performance.now()): SkyClock {
  // before the first world frame lands: mid-morning, so a cold start never
  // opens on a black screen
  let anchorWorld = DEFAULT_BALANCE.daySeconds * 0.2;
  let anchorAt = now();
  let daySeconds = DEFAULT_BALANCE.daySeconds;
  let pinned: number | undefined;
  let heard = false;
  /** the newest world time we have accepted — anything older is late delivery */
  let lastSample = 0;

  function projected(): number {
    return anchorWorld + Math.max(0, (now() - anchorAt) / 1000);
  }

  return {
    sync(worldSeconds, secondsPerDay) {
      if (Number.isFinite(secondsPerDay) && secondsPerDay > 0) {
        daySeconds = secondsPerDay;
      }
      if (!Number.isFinite(worldSeconds)) return;
      // frames can arrive out of order on the stream transport; an older
      // sample must never drag the sun backwards. A big jump back is a
      // different world (a restart or a wipe) and is honoured.
      const stale = heard && worldSeconds <= lastSample;
      const reborn = heard && lastSample - worldSeconds >= RESET_TOLERANCE_SECONDS;
      if (stale && !reborn) return;
      // a fresh sample rules. Between samples the sky free-runs on the local
      // clock, but it is never allowed to wander from the server's — otherwise
      // two spectators who opened the page hours apart drift into different
      // hours of the same day.
      if (heard && !reborn && Math.abs(projected() - worldSeconds) < SLEW_TOLERANCE_SECONDS) {
        lastSample = worldSeconds;
        return;
      }
      anchorWorld = worldSeconds;
      anchorAt = now();
      lastSample = worldSeconds;
      heard = true;
    },
    phase() {
      if (pinned !== undefined) return pinned;
      return dayPhase(projected(), daySeconds);
    },
    worldTime() {
      return projected();
    },
    pin(fraction) {
      pinned = ((fraction % 1) + 1) % 1;
    },
    unpin() {
      pinned = undefined;
    },
    get synced() {
      return heard;
    },
  };
}
