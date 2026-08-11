import { describe, expect, it } from "vitest";
import type { Building } from "../shared/types";
import type { IslandSummary } from "./net";

import {
  FRAMING_SCALE_RANGE,
  landingShot,
  openingIslandId,
  townFraming,
} from "./openingView";

const summary = (id: string, lastPulseSeq: number, population = 0) =>
  ({ id, lastPulseSeq, population } as IslandSummary);

describe("opening view", () => {
  it("lands an owner at home and a spectator at recent populated land", () => {
    const islands = [summary("quiet", 2, 4), summary("alive", 9, 12)];
    expect(openingIslandId(islands)).toBe("alive");
    expect(openingIslandId(islands, "quiet")).toBe("quiet");
  });

  it("has a deterministic tie-break and no ocean-only phantom target", () => {
    expect(openingIslandId([summary("b", 1), summary("a", 1)])).toBe("a");
    expect(openingIslandId([])).toBeUndefined();
  });
});

const at = (id: string, x: number, y: number): Building =>
  ({ id, type: "hut", stage: "complete", progress: 100, pos: { x, y } } as Building);

describe("landing framing", () => {
  it("aims at the town and pulls in on a small settlement", () => {
    const half = 83;
    // a five-hut hamlet, well off the island's centre
    const hamlet = [
      at("a", 100, 60),
      at("b", 103, 62),
      at("c", 98, 64),
      at("d", 101, 58),
      at("e", 104, 61),
    ];
    const framing = townFraming(hamlet, half);
    expect(framing.offsetX).toBeGreaterThan(14);
    expect(framing.offsetZ).toBeLessThan(-18);
    // a hamlet is shot much closer than the authored hundred-block landing
    expect(framing.scale).toBe(FRAMING_SCALE_RANGE[0]);
  });

  it("never stands back past the authored landing, however large the city", () => {
    const city: Building[] = [];
    for (let i = 0; i < 200; i++) {
      const a = (i / 200) * Math.PI * 2;
      const r = 6 + (i % 40);
      city.push(at(`c${i}`, 83 + Math.cos(a) * r, 83 + Math.sin(a) * r));
    }
    const framing = townFraming(city, 83);
    expect(Math.abs(framing.offsetX)).toBeLessThan(3);
    // a metropolis is shot exactly as authored — the framing only closes in
    expect(framing.scale).toBe(1);
    expect(FRAMING_SCALE_RANGE[1]).toBe(1);
  });

  it("leaves a bare or single-building island exactly as authored", () => {
    expect(townFraming([], 83)).toEqual({ offsetX: 0, offsetZ: 0, scale: 1 });
    expect(townFraming([at("solo", 90, 90)], 83).scale).toBe(1);
  });

  it("keeps the approach due south and the pitch fixed at any scale", () => {
    const wide = landingShot(200, -50, false, { offsetX: 4, offsetZ: -6, scale: 1 });
    const close = landingShot(200, -50, false, { offsetX: 4, offsetZ: -6, scale: 0.6 });
    // same aim point, same pitch, only the distance changes
    expect(close[0]).toBe(wide[0]);
    expect(close[3]).toBe(204);
    expect(close[4]).toBe(-56);
    const pitch = (shot: number[]) => shot[1]! / (shot[2]! - shot[4]!);
    expect(pitch(close)).toBeCloseTo(pitch(wide), 6);
    expect(close[1]).toBeLessThan(wide[1]!);
  });
});
