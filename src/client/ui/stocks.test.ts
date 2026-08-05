import { describe, expect, it } from "vitest";
import { stockLines } from "./stocks";

describe("the resource panel", () => {
  it("lists every stocked resource in age order, never conversation order", () => {
    const lines = stockLines({ iron: 4, food: 12, stone: 0, wood: 700 });
    expect(lines.map((l) => l.id)).toEqual(["food", "wood", "stone", "iron"]);
  });

  it("keeps zeros visible — an empty larder is the loudest reading", () => {
    const lines = stockLines({ food: 0, wood: 3 });
    expect(lines[0]).toMatchObject({ id: "food", amount: "0" });
  });

  it("hides resources the island has never touched", () => {
    const lines = stockLines({ food: 5 });
    expect(lines).toHaveLength(1);
  });

  it("compacts hoards and floors fractions", () => {
    expect(stockLines({ wood: 12_400 })[0]!.amount).toBe("12k");
    expect(stockLines({ food: 7.9 })[0]!.amount).toBe("7");
    expect(stockLines({ gold: 9_999 })[0]!.amount).toBe("9999");
  });

  it("spells out multi-word resources", () => {
    expect(stockLines({ preciousMetals: 2 })[0]!.label).toBe("precious metals");
  });

  it("shows everything the age has unlocked, marked empty until first gathered", () => {
    const lines = stockLines({ food: 5 }, ["food", "wood", "copper"]);
    expect(lines.map((l) => l.id)).toEqual(["food", "wood", "copper"]);
    expect(lines.find((l) => l.id === "copper")).toMatchObject({ amount: "0", empty: true });
    expect(lines[0]!.empty).toBe(false);
  });
});
