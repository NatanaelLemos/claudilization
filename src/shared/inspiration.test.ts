import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE } from "./balance";
import { computeInspiration } from "./inspiration";
import type { Pulse } from "./types";

const B = DEFAULT_BALANCE;

describe("computeInspiration", () => {
  it("never yields fewer events than the floor — even for zero tokens", () => {
    for (const tokens of [0, 1, 50, 1e9]) {
      const r = computeInspiration(tokens, [], 0, B);
      expect(r.events).toBeGreaterThanOrEqual(B.inspirationFloor);
    }
  });

  it("work is monotone non-decreasing in tokens", () => {
    const small = computeInspiration(1_000, [], 0, B);
    const big = computeInspiration(100_000, [], 0, B);
    expect(big.workPoints).toBeGreaterThanOrEqual(small.workPoints);
    expect(big.events).toBeGreaterThanOrEqual(small.events);
  });

  it("diminishes within the rolling window: hammering pays less per prompt", () => {
    const now = 10_000;
    const heavy: Pulse[] = Array.from({ length: 20 }, (_, i) => ({
      time: now - i * 60,
      tokens: 50_000,
    }));
    const fresh = computeInspiration(50_000, [], now, B);
    const tired = computeInspiration(50_000, heavy, now, B);
    expect(tired.workPoints).toBeLessThan(fresh.workPoints);
    expect(tired.events).toBeGreaterThanOrEqual(B.inspirationFloor);
  });

  it("never reaches zero work, no matter the hammering", () => {
    const now = 10_000;
    const extreme: Pulse[] = Array.from({ length: 500 }, (_, i) => ({
      time: now - i * 5,
      tokens: 1e6,
    }));
    const r = computeInspiration(10_000, extreme, now, B);
    expect(r.workPoints).toBeGreaterThan(0);
  });

  it("recovers once the window has passed", () => {
    const now = 100_000;
    const old: Pulse[] = [
      { time: now - B.inspirationWindowSeconds - 10, tokens: 1e6 },
    ];
    const fresh = computeInspiration(50_000, [], now, B);
    const rested = computeInspiration(50_000, old, now, B);
    expect(rested.workPoints).toBeCloseTo(fresh.workPoints, 5);
  });
});
