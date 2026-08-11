import { describe, expect, it } from "vitest";
import type { IslandSummary } from "./net";
import { openingIslandId } from "./openingView";

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
