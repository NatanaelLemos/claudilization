import { describe, expect, it } from "vitest";
import { dayPhase, isDayBoundary, isNight, secondsIntoDay } from "./daylight";

describe("one sun for the whole ocean", () => {
  it("the phase is a pure function of world time — same time, same sky", () => {
    expect(dayPhase(900, 3600)).toBeCloseTo(0.25);
    expect(dayPhase(900 + 3600 * 9, 3600)).toBeCloseTo(0.25);
    // called a thousand times, it never drifts: nothing accumulates
    const once = dayPhase(1234, 3600);
    for (let i = 0; i < 1000; i++) expect(dayPhase(1234, 3600)).toBe(once);
  });

  it("night is the share of the day the sun is down, wherever you look", () => {
    expect(isNight(0, 100, 0.55)).toBe(false);
    expect(isNight(54, 100, 0.55)).toBe(false);
    expect(isNight(55, 100, 0.55)).toBe(true);
    expect(isNight(99, 100, 0.55)).toBe(true);
    expect(isNight(100, 100, 0.55)).toBe(false); // a new dawn
  });

  it("day boundaries land on the world's own day, and only there", () => {
    expect(isDayBoundary(0, 100)).toBe(false); // the first dawn is creation
    expect(isDayBoundary(99, 100)).toBe(false);
    expect(isDayBoundary(100, 100)).toBe(true);
    expect(isDayBoundary(101, 100)).toBe(false);
    expect(isDayBoundary(300, 100)).toBe(true);
  });

  it("survives nonsense laws instead of rendering a black sky", () => {
    expect(secondsIntoDay(50, 0)).toBe(0);
    expect(dayPhase(50, 0)).toBe(0);
    expect(dayPhase(-10, 100)).toBeCloseTo(0.9); // clocks run forward, always
  });
});
