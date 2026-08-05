import { describe, expect, it } from "vitest";
import type { Building, Island, Settler } from "../../shared/types";
import { buildingCard } from "./buildingPanel";

function isle(overrides: Partial<Island> = {}): Island {
  return {
    id: "island-1",
    name: "Kagerou",
    civ: "japanese",
    seed: 1,
    age: "bronze",
    kind: "home",
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
    ...overrides,
  };
}

function bld(overrides: Partial<Building> = {}): Building {
  return {
    id: "b-1",
    type: "farm",
    stage: "complete",
    progress: 0,
    pos: { x: 0, y: 0 },
    ...overrides,
  };
}

function settler(name: string, houseId: string | undefined, adult = true): Settler {
  return {
    id: `s-${name}`,
    name,
    adult,
    bornAt: 0,
    task: { kind: "idle" } as Settler["task"],
    pos: { x: 0, y: 0 },
    hungerDays: 0,
    houseId,
  };
}

describe("the building inspector card", () => {
  it("spells the type as a proper name with its age", () => {
    const card = buildingCard(bld({ type: "elder-lodge" }), isle());
    expect(card.title).toBe("Elder Lodge");
    expect(card.meta).toBe("stone age");
  });

  it("tells every building's story — no type goes unnamed", () => {
    const card = buildingCard(bld({ type: "dyson-relay" }), isle());
    expect(card.description).toMatch(/sunlight/i);
  });

  it("shows what a finished building was built from", () => {
    const card = buildingCard(bld({ type: "farm" }), isle());
    expect(card.facts.some((f) => f.startsWith("Built from") && f.includes("30 wood"))).toBe(true);
  });

  it("reports construction progress and the labor still owed", () => {
    // a farm takes 50 worker-seconds; 20 in means 40%
    const card = buildingCard(bld({ stage: "construction", progress: 20 }), isle());
    expect(card.meta).toContain("under construction — 40%");
    expect(card.facts).toContain("30 worker-seconds of labor remain");
  });

  it("counts the tenants of a house by name, children marked", () => {
    const island = isle({
      settlers: [
        settler("Takeshi", "b-1"),
        settler("Chiyo", "b-1", false),
        settler("Sakura", "elsewhere"),
      ],
    });
    const card = buildingCard(bld({ type: "elder-lodge" }), island);
    const line = card.facts.find((f) => f.startsWith("Shelter for 3"))!;
    expect(line).toContain("Takeshi & Chiyo (child)");
    expect(line).toContain("(2/3)");
    expect(line).not.toContain("Sakura");
  });

  it("shows daily food from farms and that nothing is consumed once built", () => {
    const card = buildingCard(bld({ type: "farm" }), isle());
    expect(card.facts.some((f) => f.includes("8 food each day"))).toBe(true);
    expect(card.facts.some((f) => f.startsWith("Consumes nothing"))).toBe(true);
  });

  it("keeps its footing on a type the catalog has never heard of", () => {
    const card = buildingCard(bld({ type: "mystery-shed" }), isle());
    expect(card.title).toBe("Mystery Shed");
    expect(card.meta).toBe("unknown age");
    expect(card.description).toContain("Kagerou");
  });
});
