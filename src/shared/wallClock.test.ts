import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE } from "./balance";
import {
  dayAnchorMs,
  dayPhase,
  dayWindows,
  isNight,
  secondsIntoDay,
  worldSecondsAt,
} from "./daylight";

/**
 * The law of the sky, pinned.
 *
 * One real hour is one island day: 50 minutes of sun, 10 of night. The phase is
 * read off the wall clock — never counted by a timer — so a restart, a slow
 * server or a spectator opening the page for the first time all land on exactly
 * the same sky at the same instant.
 */

const DAY = DEFAULT_BALANCE.daySeconds;
const SHARE = DEFAULT_BALANCE.daylightShare;

/** A real instant, stated as plainly as a clock on the wall. */
const at = (iso: string) => Date.parse(iso);

describe("one real hour is one island day, 50 minutes of it lit", () => {
  it("splits the day exactly 3000 seconds of sun to 600 of night", () => {
    expect(DAY).toBe(3600);
    const { daylightSeconds, nightSeconds } = dayWindows(DAY, SHARE);
    expect(daylightSeconds).toBe(50 * 60);
    expect(nightSeconds).toBe(10 * 60);
    // the boundary is exact, to the second
    expect(isNight(2999, DAY, SHARE)).toBe(false);
    expect(isNight(3000, DAY, SHARE)).toBe(true);
    expect(isNight(3599, DAY, SHARE)).toBe(true);
    expect(isNight(3600, DAY, SHARE)).toBe(false); // a new dawn
  });

  it("anchors the world's zero to the top of a real hour", () => {
    const anchor = dayAnchorMs(at("2026-08-04T20:37:12.500Z"), DAY);
    expect(new Date(anchor).toISOString()).toBe("2026-08-04T20:00:00.000Z");
    // and the world's clock at that instant is the seconds into the hour
    expect(worldSecondsAt(at("2026-08-04T20:37:12.500Z"), anchor)).toBe(37 * 60 + 12);
  });

  it("maps a given real instant to a known phase, sun up or sun down", () => {
    const anchor = dayAnchorMs(at("2026-08-04T20:00:00Z"), DAY);
    const sky = (iso: string) => {
      const t = worldSecondsAt(at(iso), anchor);
      return {
        clock: secondsIntoDay(t, DAY),
        phase: Number(dayPhase(t, DAY).toFixed(6)),
        night: isNight(t, DAY, SHARE),
      };
    };
    expect(sky("2026-08-04T20:00:00Z")).toEqual({ clock: 0, phase: 0, night: false });
    expect(sky("2026-08-04T20:25:00Z")).toEqual({ clock: 1500, phase: 0.416667, night: false });
    expect(sky("2026-08-04T20:49:59Z")).toEqual({ clock: 2999, phase: 0.833056, night: false });
    // :50 past every hour, the sun goes down
    expect(sky("2026-08-04T20:50:00Z")).toEqual({ clock: 3000, phase: 0.833333, night: true });
    expect(sky("2026-08-04T20:59:59Z")).toEqual({ clock: 3599, phase: 0.999722, night: true });
    // :00 of the next hour, it comes back up — a whole day later
    expect(sky("2026-08-04T21:00:00Z")).toEqual({ clock: 0, phase: 0, night: false });
    // and days later, the same wall-clock minute reads the same sky
    expect(sky("2026-08-09T03:25:00Z")).toEqual({ clock: 1500, phase: 0.416667, night: false });
  });

  it("never drifts: the phase is read from the clock, not accumulated", () => {
    const anchor = dayAnchorMs(at("2026-08-04T20:00:00Z"), DAY);
    // a server that has been up for a hundred days reads the same sky as one
    // booted this second, because neither of them is counting
    const long = worldSecondsAt(at("2026-11-12T13:25:00Z"), anchor);
    const fresh = worldSecondsAt(at("2026-11-12T13:25:00Z"), dayAnchorMs(at("2026-11-12T13:25:00Z"), DAY));
    expect(dayPhase(long, DAY)).toBeCloseTo(dayPhase(fresh, DAY), 10);
    expect(secondsIntoDay(fresh, DAY)).toBe(25 * 60);
  });
});
