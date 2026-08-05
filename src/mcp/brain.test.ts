import { describe, expect, it } from "vitest";
import { extractOrders } from "./brain";

describe("extractOrders — a model reply becomes an orders array", () => {
  it("takes a clean JSON array as-is", () => {
    expect(extractOrders('[{"kind":"advance_age"}]')).toEqual([
      { kind: "advance_age" },
    ]);
    expect(extractOrders("  []  ")).toEqual([]);
  });

  it("digs the array out of stray prose and code fences", () => {
    const reply =
      'Here are my orders:\n```json\n[{"kind":"build","building":"hut"}]\n```\nDone.';
    expect(extractOrders(reply)).toEqual([{ kind: "build", building: "hut" }]);
  });

  it("throws when there is no array at all", () => {
    expect(() => extractOrders("the island prospers")).toThrow(/no JSON array/);
  });
});
