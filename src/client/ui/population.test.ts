import { afterEach, describe, expect, it, vi } from "vitest";
import { populationReading, updatePopulation } from "./population";

function settlers(count: number): { settlers: never[] } {
  return { settlers: Array.from({ length: count }) as never[] };
}

afterEach(() => vi.unstubAllGlobals());

describe("the population status pill", () => {
  it("reads the simulation's canonical settler count with an unambiguous label", () => {
    expect(populationReading(settlers(12))).toEqual({
      count: 12,
      label: "people",
      text: "👥 12 people",
    });
    expect(populationReading(settlers(1)).text).toBe("👥 1 person");
  });

  it("rerenders when a live island frame carries a changed population", () => {
    const element = { hidden: true, textContent: "", title: "" };
    vi.stubGlobal("document", { getElementById: () => element });

    updatePopulation(settlers(10));
    expect(element).toMatchObject({
      hidden: false,
      textContent: "👥 10 people",
      title: "10 people live in your civilization",
    });

    updatePopulation(settlers(11));
    expect(element.textContent).toBe("👥 11 people");
  });
});
