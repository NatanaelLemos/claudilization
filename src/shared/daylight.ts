/**
 * One sun for the whole ocean.
 *
 * The turning of the day is a pure function of world time — never of which
 * island happens to be on screen, never of when a scene mounted, never of a
 * counter that pauses while an island sleeps. Every island and every viewer
 * reads the same monotonic clock, so peeking at a neighbour cannot move the
 * sun, and a client that reconnects mid-night resolves instantly to the true
 * phase instead of drifting from wherever it left off.
 *
 * World time itself is wall-clock: the world keeps an `anchorMs`, the real
 * instant its clock read zero, so `worldSecondsAt` below is the only definition
 * of "now". A restart, a slow event loop or an hour of downtime cannot move the
 * sun, because nothing accumulates — the clock is read, never counted. The
 * anchor is snapped down to a whole day (`dayAnchorMs`), so dawn lands on a
 * round wall-clock hour and every spectator on earth sees the same sky at the
 * same second.
 */

/**
 * The real instant a world's clock should read zero: the start of the day-long
 * window `nowMs` falls in. With a 3600 s day this is the top of the current
 * hour, so day breaks at :00 and night falls a fixed number of minutes later,
 * forever, on every machine.
 */
export function dayAnchorMs(nowMs: number, daySeconds: number): number {
  if (!(daySeconds > 0)) return nowMs;
  const dayMs = daySeconds * 1000;
  return Math.floor(nowMs / dayMs) * dayMs;
}

/** World seconds at a real instant — the world's clock is the wall clock. */
export function worldSecondsAt(nowMs: number, anchorMs: number): number {
  return Math.floor((nowMs - anchorMs) / 1000);
}

/** Seconds elapsed since the world's last day boundary. */
export function secondsIntoDay(worldSeconds: number, daySeconds: number): number {
  if (!(daySeconds > 0)) return 0;
  return ((worldSeconds % daySeconds) + daySeconds) % daySeconds;
}

/** Where the world stands in its day, 0 (dawn) → 1 (next dawn). */
export function dayPhase(worldSeconds: number, daySeconds: number): number {
  if (!(daySeconds > 0)) return 0;
  return secondsIntoDay(worldSeconds, daySeconds) / daySeconds;
}

/**
 * True once the sun is down. The same law the settlers obey when they walk
 * home for the night, so the sky a viewer sees always matches the world's
 * behaviour.
 */
export function isNight(
  worldSeconds: number,
  daySeconds: number,
  daylightShare: number,
): boolean {
  return dayPhase(worldSeconds, daySeconds) >= daylightShare;
}

/** True on the tick a new world day begins (t = 0 is the world's first dawn). */
export function isDayBoundary(worldSeconds: number, daySeconds: number): boolean {
  if (!(daySeconds > 0)) return false;
  return worldSeconds > 0 && secondsIntoDay(worldSeconds, daySeconds) === 0;
}

/**
 * Which day of the world this is. The world turns its day when this number
 * changes, so a clock that jumps a gap — a restart, an hour of downtime —
 * still turns the day exactly once instead of stepping over the boundary.
 */
export function dayIndex(worldSeconds: number, daySeconds: number): number {
  if (!(daySeconds > 0)) return 0;
  return Math.floor(worldSeconds / daySeconds);
}

/** How the day splits: seconds of sun, then seconds of dark. */
export function dayWindows(
  daySeconds: number,
  daylightShare: number,
): { daylightSeconds: number; nightSeconds: number } {
  if (!(daySeconds > 0)) return { daylightSeconds: 0, nightSeconds: 0 };
  let daylightSeconds = 0;
  for (let s = 0; s < daySeconds; s++) {
    if (!isNight(s, daySeconds, daylightShare)) daylightSeconds++;
  }
  return { daylightSeconds, nightSeconds: daySeconds - daylightSeconds };
}
