import { describe, expect, it } from "vitest";
import { parseOrders } from "./orders";

describe("parseOrders — the closed order vocabulary", () => {
  it("accepts every legal order kind", () => {
    const orders = [
      { kind: "assign_gathering", resource: "wood", count: 3 },
      { kind: "build", building: "hut" },
      { kind: "build_boat" },
      { kind: "build_plane" },
      { kind: "voyage", dest: "island-2", intent: "trade" },
      { kind: "voyage", dest: "island-3", intent: "help" },
      { kind: "voyage", dest: "island-4", intent: "colonize" },
      { kind: "voyage", dest: "island-5", intent: "attack" },
      { kind: "advance_age" },
    ];
    expect(parseOrders(orders)).toEqual(orders);
  });

  it("rejects unknown kinds", () => {
    expect(() => parseOrders([{ kind: "attack", dest: "x" }])).toThrow();
    expect(() => parseOrders([{ kind: "free_text", text: "hi" }])).toThrow();
  });

  it("rejects a voyage intent outside the vocabulary", () => {
    expect(() =>
      parseOrders([{ kind: "voyage", dest: "x", intent: "plunder" }]),
    ).toThrow();
  });

  it("rejects malformed payloads", () => {
    expect(() => parseOrders("orders")).toThrow();
    expect(() => parseOrders([{ kind: "assign_gathering", resource: "wood", count: -1 }])).toThrow();
    expect(() => parseOrders([{ kind: "assign_gathering", resource: 7, count: 1 }])).toThrow();
    expect(() => parseOrders([{ kind: "build" }])).toThrow();
  });

  it("caps a single submission at 10 orders", () => {
    const many = Array.from({ length: 11 }, () => ({ kind: "advance_age" }));
    expect(() => parseOrders(many)).toThrow();
  });
});
