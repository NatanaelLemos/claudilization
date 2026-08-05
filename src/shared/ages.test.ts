import { describe, expect, it } from "vitest";
import { AGES, AGE_RESOURCES, advanceRequirements, nextAge } from "./ages";
import { DEFAULT_BALANCE } from "./balance";
import { computeInspiration } from "./inspiration";
import type { Pulse } from "./types";

const B = DEFAULT_BALANCE;

describe("the nine ages", () => {
  it("are exactly the nine, in order", () => {
    expect(AGES).toEqual([
      "stone",
      "bronze",
      "iron",
      "classical",
      "medieval",
      "renaissance",
      "industrial",
      "modern",
      "future",
    ]);
  });

  it("unlock exactly the manager plan's resource lists", () => {
    expect(AGE_RESOURCES.stone).toEqual(["food", "wood", "stone"]);
    expect(AGE_RESOURCES.bronze).toEqual([
      "food", "wood", "stone", "copper", "tin",
    ]);
    expect(AGE_RESOURCES.iron).toEqual([
      "food", "wood", "stone", "copper", "tin", "iron", "steel",
    ]);
    const classical = [
      "food", "wood", "stone", "copper", "tin", "iron", "steel",
      "marble", "gold", "silver", "preciousMetals", "gems",
    ];
    expect(AGE_RESOURCES.classical).toEqual(classical);
    expect(AGE_RESOURCES.medieval).toEqual(classical);
    expect(AGE_RESOURCES.renaissance).toEqual([...classical, "coal"]);
    expect(AGE_RESOURCES.industrial).toEqual([...classical, "coal", "oil", "gas"]);
    expect(AGE_RESOURCES.modern).toEqual([
      ...classical, "coal", "oil", "gas", "plutonium",
    ]);
    expect(AGE_RESOURCES.future).toEqual([
      ...classical, "coal", "oil", "gas", "plutonium", "antimatter",
    ]);
  });

  it("nextAge walks the ladder and ends after future", () => {
    expect(nextAge("stone")).toBe("bronze");
    expect(nextAge("modern")).toBe("future");
    expect(nextAge("future")).toBeNull();
  });

  it("every advancement strictly costs at least ×2 the previous, on the same metric", () => {
    for (let i = 2; i < AGES.length; i++) {
      const prev = advanceRequirements(AGES[i - 1]!, B);
      const cur = advanceRequirements(AGES[i]!, B);
      expect(cur).toBeGreaterThanOrEqual(prev * B.ageCostMultiplier);
      expect(cur).toBeGreaterThan(prev);
    }
  });

  it("paces Bronze at about a week of steady daily use — not one day", () => {
    // A reference workday: referenceDailyTokens spread over 40 prompts, 8 hours.
    const dayWork = () => {
      let history: Pulse[] = [];
      let work = 0;
      const prompts = 40;
      const per = B.referenceDailyTokens / prompts;
      for (let i = 0; i < prompts; i++) {
        const time = i * (8 * 3600) / prompts;
        const r = computeInspiration(per, history, time, B);
        work += r.workPoints;
        history.push({ time, tokens: per });
      }
      return work;
    };
    const oneDay = dayWork();
    const bronze = advanceRequirements("bronze", B);
    expect(oneDay).toBeLessThan(bronze); // never in a single day
    expect(oneDay * 5).toBeGreaterThanOrEqual(bronze); // within a work week
  });
});
