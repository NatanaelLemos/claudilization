import { describe, expect, it } from "vitest";
import { AGE_RESOURCES, AGES } from "./ages";
import { buildingSpec } from "./buildings";
import { CIV_IDS } from "./types";
import { WONDER_CIV, WONDERS, wonderFor } from "./wonders";

describe("the wonders of the world", () => {
  it("every [civilization × age] has exactly one wonder — 72 in all, no name shared", () => {
    expect(WONDERS).toHaveLength(CIV_IDS.length * AGES.length);
    expect(new Set(WONDERS.map((w) => w.type)).size).toBe(WONDERS.length);
    for (const civ of CIV_IDS) {
      for (const age of AGES) {
        const w = wonderFor(civ, age);
        expect(w.age).toBe(age);
        expect(WONDER_CIV.get(w.type)).toBe(civ);
      }
    }
  });

  it("wonders cost thousands, only in resources their age has unlocked", () => {
    for (const w of WONDERS) {
      const total = Object.values(w.cost).reduce((a, b) => a + (b ?? 0), 0);
      expect(total, `${w.type} is too cheap`).toBeGreaterThanOrEqual(2000);
      for (const res of Object.keys(w.cost)) {
        expect(
          AGE_RESOURCES[w.age],
          `${w.type} costs ${res} before ${w.age} unlocks it`,
        ).toContain(res);
      }
    }
  });

  it("wonders are proud, slow, joyful builds the catalog can look up", () => {
    for (const w of WONDERS) {
      expect(w.wonder).toBe(true);
      expect(w.joy).toBeGreaterThanOrEqual(25);
      expect(w.buildSeconds).toBeGreaterThanOrEqual(300);
      expect(buildingSpec(w.type)).toBe(w);
    }
  });
});
