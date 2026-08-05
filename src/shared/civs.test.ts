import { describe, expect, it } from "vitest";
import { AGES, AGE_RESOURCES } from "./ages";
import { BUILDINGS, buildingSpec } from "./buildings";
import { CIVS } from "./civs";
import { CIV_IDS } from "./types";

describe("civilizations — total flavor", () => {
  it("defines exactly the playable civilizations", () => {
    expect(Object.keys(CIVS).sort()).toEqual([...CIV_IDS].sort());
  });

  it("every civ has a rich, unique settler name bank", () => {
    for (const id of CIV_IDS) {
      const bank = CIVS[id].nameBank;
      expect(bank.length).toBeGreaterThanOrEqual(20);
      expect(new Set(bank).size).toBe(bank.length);
    }
  });

  it("every civ has island names, architecture, boat, and a feed voice", () => {
    for (const id of CIV_IDS) {
      const civ = CIVS[id];
      expect(civ.islandNames.length).toBeGreaterThanOrEqual(5);
      expect(civ.architecture.primary).toBeTruthy();
      expect(civ.boat.shape).toBeTruthy();
      for (const key of ["build", "birth", "death"] as const) {
        expect(civ.voice[key]).toContain("{name}");
      }
      expect(civ.voice.ageUp).toContain("{island}");
    }
  });

  it("the four flavor channels actually differ between civs", () => {
    const accents = CIV_IDS.map((id) => CIVS[id].accent);
    expect(new Set(accents).size).toBe(CIV_IDS.length);
    const voices = CIV_IDS.map((id) => CIVS[id].voice.build);
    expect(new Set(voices).size).toBe(CIV_IDS.length);
  });
});

describe("building catalog", () => {
  it("adds at least fifteen building kinds in every one of the nine ages", () => {
    for (const age of AGES) {
      const inAge = BUILDINGS.filter((b) => b.age === age);
      expect(inAge.length, `age ${age}`).toBeGreaterThanOrEqual(15);
    }
  });

  it("never repeats a building type name", () => {
    const types = BUILDINGS.map((b) => b.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it("has a Stone Age house that can shelter a family", () => {
    const house = BUILDINGS.find((b) => b.age === "stone" && (b.houses ?? 0) >= 2);
    expect(house).toBeDefined();
  });

  it("gates dock and boat at the Bronze Age", () => {
    expect(buildingSpec("dock")?.age).toBe("bronze");
    expect(buildingSpec("boat")?.age).toBe("bronze");
  });

  it("never costs a resource its own age hasn't unlocked", () => {
    for (const b of BUILDINGS) {
      for (const res of Object.keys(b.cost)) {
        expect(
          AGE_RESOURCES[b.age],
          `${b.type} costs ${res} before ${b.age} unlocks it`,
        ).toContain(res);
      }
    }
  });

  it("every construction takes time", () => {
    for (const b of BUILDINGS) {
      expect(b.buildSeconds, b.type).toBeGreaterThan(0);
    }
  });
});
