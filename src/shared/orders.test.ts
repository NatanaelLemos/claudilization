import { describe, expect, it } from "vitest";
import { parseOrders, parseOrdersForward, screenOrders } from "./orders";

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

  it("accepts the creation orders", () => {
    const creation = {
      name: "Moon Ninjas",
      description: "silent blades",
      sprite: {
        size: 8,
        palette: ["#1a1a2e", "#e94560"],
        pixels: [
          "..00....", ".0110...", "..00....", ".0000...",
          "0.00.0..", "..00....", ".0..0...", "0....0..",
        ],
      },
      stats: { power: 7, speed: 5, resilience: 3 },
      verbs: ["raid", "patrol"],
      count: 4,
    };
    const parsed = parseOrders([
      { kind: "create", creation },
      { kind: "dispatch", creation: "Moon Ninjas", dest: "island-7", count: 3 },
      { kind: "disband", creation: "Moon Ninjas" },
    ]);
    expect(parsed).toHaveLength(3);
  });

  it("rejects a create order whose design fails the gate", () => {
    expect(() =>
      parseOrders([{ kind: "create", creation: { name: "<script>x</script>" } }]),
    ).toThrow();
    expect(() => parseOrders([{ kind: "create" }])).toThrow();
    expect(() =>
      parseOrders([{ kind: "dispatch", creation: "", dest: "island-7" }]),
    ).toThrow();
    expect(() =>
      parseOrders([{ kind: "dispatch", creation: "N".repeat(65), dest: "island-7" }]),
    ).toThrow();
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

describe("parseOrdersForward — the installed client's forward-compatible gate", () => {
  it("stays strict for kinds this build knows", () => {
    expect(() =>
      parseOrdersForward([{ kind: "assign_gathering", resource: "wood", count: -1 }]),
    ).toThrow();
    expect(() => parseOrdersForward([{ kind: "build" }])).toThrow();
    expect(() => parseOrdersForward(["free text"])).toThrow();
  });

  it("forwards an unknown kind untouched for the server to judge", () => {
    const alien = { kind: "summon_kraken", size: 9 };
    expect(parseOrdersForward([{ kind: "advance_age" }, alien])).toEqual([
      { kind: "advance_age" },
      alien,
    ]);
  });

  it("refuses unknown kinds that are not plain order names", () => {
    expect(() => parseOrdersForward([{ kind: "DROP TABLE" }])).toThrow();
    expect(() => parseOrdersForward([{ kind: "<script>alert(1)</script>" }])).toThrow();
    expect(() => parseOrdersForward([{ kind: "x".repeat(40) }])).toThrow();
  });

  it("caps the size of a forwarded order", () => {
    expect(() =>
      parseOrdersForward([{ kind: "future_thing", blob: "x".repeat(9000) }]),
    ).toThrow();
  });

  it("keeps the batch shape rules", () => {
    expect(() => parseOrdersForward("orders")).toThrow();
    const many = Array.from({ length: 11 }, () => ({ kind: "advance_age" }));
    expect(() => parseOrdersForward(many)).toThrow();
  });
});

describe("screenOrders — the server judges each order alone", () => {
  it("separates the carried from the refused without failing the batch", () => {
    const screened = screenOrders([
      { kind: "advance_age" },
      { kind: "summon_kraken", size: 9 },
      { kind: "build" },
    ]);
    expect(screened[0]).toEqual({ ok: true, order: { kind: "advance_age" } });
    expect(screened[1]!.ok).toBe(false);
    expect((screened[1] as { reason: string }).reason).toContain("unknown order kind");
    expect(screened[2]!.ok).toBe(false);
  });

  it("still throws on a broken batch shape", () => {
    expect(() => screenOrders("orders")).toThrow();
    const many = Array.from({ length: 11 }, () => ({ kind: "advance_age" }));
    expect(() => screenOrders(many)).toThrow();
  });
});
