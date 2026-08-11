import { describe, expect, it } from "vitest";
import type { Building } from "../shared/types";
import { isSmokeBuilding, townEffectCounts } from "./townEffects";

const building = (type: string, id: string, stage: Building["stage"] = "complete"): Building => ({
  id,
  type,
  stage,
  progress: 0,
  pos: { x: 10, y: 10 },
});

describe("town life effects", () => {
  it("puts restrained smoke only on buildings that plausibly burn fuel", () => {
    expect(isSmokeBuilding("blacksmith")).toBe(true);
    expect(isSmokeBuilding("coking-plant")).toBe(true);
    expect(isSmokeBuilding("hut")).toBe(false);
    expect(isSmokeBuilding("temple")).toBe(false);
  });

  it("caps both effect families and ignores unfinished sites", () => {
    const buildings = Array.from({ length: 30 }, (_, i) => building("blacksmith", `b-${i}`));
    buildings.push(building("blacksmith", "site", "construction"));
    buildings.push(building("watchtower", "flag"));
    const counts = townEffectCounts(buildings);
    expect(counts.smokeSources).toBe(10);
    expect(counts.flags).toBe(1);
  });
});

