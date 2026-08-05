import { describe, expect, it } from "vitest";
import {
  CIV_COLOR_LIGHT,
  CIV_COLOR_SAT,
  civAccented,
  ensureCivColors,
  hexToHsl,
  hslToHex,
  hueDistance,
  pickCivColor,
  shadeCivColor,
} from "./civColor";
import { CIVS } from "./civs";
import { mulberry32 } from "./rng";
import type { Island } from "./types";

const HEX = /^#[0-9a-f]{6}$/;

describe("color math", () => {
  it("round-trips hue through hex within a degree", () => {
    for (const h of [0, 37, 120, 210, 300, 359]) {
      const back = hexToHsl(hslToHex(h, 0.6, 0.5));
      expect(hueDistance(back.h, h)).toBeLessThan(1.5);
      expect(back.s).toBeCloseTo(0.6, 1);
      expect(back.l).toBeCloseTo(0.5, 1);
    }
  });

  it("measures hue distance the short way around the circle", () => {
    expect(hueDistance(10, 350)).toBe(20);
    expect(hueDistance(0, 180)).toBe(180);
    expect(hueDistance(90, 90)).toBe(0);
  });

  it("derives lighter and darker shades of the same hue", () => {
    const base = hslToHex(200, 0.6, 0.5);
    const lighter = shadeCivColor(base, 0.25);
    const darker = shadeCivColor(base, -0.25);
    expect(hexToHsl(lighter).l).toBeGreaterThan(0.7);
    expect(hexToHsl(darker).l).toBeLessThan(0.3);
    expect(hueDistance(hexToHsl(lighter).h, 200)).toBeLessThan(3);
    expect(shadeCivColor(base, 5)).toBe("#ffffff"); // clamped, never invalid
  });
});

describe("pickCivColor", () => {
  it("keeps every color inside the readable saturation and lightness bands", () => {
    const rand = mulberry32(7);
    const colors: string[] = [];
    for (let i = 0; i < 10; i++) colors.push(pickCivColor(colors, rand));
    for (const c of colors) {
      expect(c).toMatch(HEX);
      const { s, l } = hexToHsl(c);
      expect(s).toBeGreaterThanOrEqual(CIV_COLOR_SAT[0] - 0.03);
      expect(s).toBeLessThanOrEqual(CIV_COLOR_SAT[1] + 0.03);
      expect(l).toBeGreaterThanOrEqual(CIV_COLOR_LIGHT[0] - 0.03);
      expect(l).toBeLessThanOrEqual(CIV_COLOR_LIGHT[1] + 0.03);
    }
  });

  it("never deals two civilizations near-identical hues", () => {
    // 12 civs on a 360-degree circle: perfect spacing is 30 degrees. The
    // widest-gap rule with capped jitter must keep every pair well apart.
    const rand = mulberry32(42);
    const colors: string[] = [];
    for (let i = 0; i < 12; i++) colors.push(pickCivColor(colors, rand));
    for (let a = 0; a < colors.length; a++) {
      for (let b = a + 1; b < colors.length; b++) {
        const gap = hueDistance(hexToHsl(colors[a]!).h, hexToHsl(colors[b]!).h);
        expect(gap).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it("lands the second color roughly opposite the first", () => {
    const first = pickCivColor([], mulberry32(3));
    const second = pickCivColor([first], mulberry32(4));
    const gap = hueDistance(hexToHsl(first).h, hexToHsl(second).h);
    expect(gap).toBeGreaterThan(150);
  });

  it("is deterministic for the same random stream", () => {
    const existing = ["#a03333", "#2563a8"];
    expect(pickCivColor(existing, mulberry32(9))).toBe(
      pickCivColor(existing, mulberry32(9)),
    );
  });
});

function bareIsland(over: Partial<Island>): Island {
  return {
    id: "island-1",
    name: "Testholm",
    civ: "norse",
    seed: 11,
    age: "stone",
    kind: "home",
    origin: "home",
    position: { x: 0, y: 0 },
    settlers: [],
    buildings: [],
    boats: [],
    nodes: [],
    stocks: {},
    workPoints: 0,
    ruins: false,
    dormant: false,
    lastPulseAt: 0,
    lastPulseSeq: 0,
    dayClock: 0,
    ...over,
  };
}

describe("ensureCivColors (the backfill law)", () => {
  it("deals every colorless home island a distinct color, in id order", () => {
    const islands = [
      bareIsland({ id: "island-3", seed: 31 }),
      bareIsland({ id: "island-1", seed: 11 }),
      bareIsland({ id: "island-2", seed: 21 }),
    ];
    ensureCivColors(islands);
    const colors = islands.map((i) => i.color!);
    expect(new Set(colors).size).toBe(3);
    for (const c of colors) expect(c).toMatch(HEX);
    // deterministic: the same save deals the same hand on every boot,
    // whatever order the islands arrive in
    const shuffled = [
      bareIsland({ id: "island-2", seed: 21 }),
      bareIsland({ id: "island-3", seed: 31 }),
      bareIsland({ id: "island-1", seed: 11 }),
    ];
    ensureCivColors(shuffled);
    for (const island of shuffled) {
      expect(island.color).toBe(islands.find((i) => i.id === island.id)!.color);
    }
  });

  it("never repaints an island that already flies a color", () => {
    const painted = bareIsland({ id: "island-1", color: "#aa3355" });
    const bare = bareIsland({ id: "island-2", seed: 21 });
    ensureCivColors([painted, bare]);
    expect(painted.color).toBe("#aa3355");
    expect(bare.color).toMatch(HEX);
    expect(bare.color).not.toBe("#aa3355");
  });

  it("leaves colonies and wild land colorless — they fly their ruler's color", () => {
    const colony = bareIsland({
      id: "island-2",
      kind: "colony",
      origin: "neutral",
      ownerId: "island-1",
    });
    const wild = bareIsland({ id: "island-3", kind: "wild", origin: "neutral" });
    ensureCivColors([bareIsland({}), colony, wild]);
    expect(colony.color).toBeUndefined();
    expect(wild.color).toBeUndefined();
  });
});

describe("civAccented (wearing the color)", () => {
  it("dresses accent, roof trim, and sails in the civ's color and its shades", () => {
    const dressed = civAccented(CIVS.roman, "#3a7d44");
    expect(dressed.accent).toBe("#3a7d44");
    expect(dressed.architecture.trim).toBe("#3a7d44");
    // sails are a pale shade of the same hue, never a hardcoded second color
    const sail = hexToHsl(dressed.boat.sail);
    expect(hueDistance(sail.h, hexToHsl("#3a7d44").h)).toBeLessThan(6);
    expect(sail.l).toBeGreaterThan(hexToHsl("#3a7d44").l);
    // cultural shapes stay the civilization type's own
    expect(dressed.architecture.primary).toBe(CIVS.roman.architecture.primary);
    expect(dressed.architecture.roof).toBe(CIVS.roman.architecture.roof);
    expect(dressed.boat.hull).toBe(CIVS.roman.boat.hull);
    expect(dressed.nameBank).toBe(CIVS.roman.nameBank);
  });

  it("returns the untouched spec when there is no color, and caches when there is", () => {
    expect(civAccented(CIVS.greek)).toBe(CIVS.greek);
    expect(civAccented(CIVS.greek, undefined)).toBe(CIVS.greek);
    expect(civAccented(CIVS.greek, "#3a7d44")).toBe(civAccented(CIVS.greek, "#3a7d44"));
  });
});
