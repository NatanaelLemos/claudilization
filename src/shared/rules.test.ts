import { describe, expect, it } from "vitest";
import { CreationInputSchema } from "./creations";
import { CATASTROPHE_IDS } from "./catastrophes";
import { ORDER_KINDS, parseOrders } from "./orders";
import { CREATION_EXAMPLE, gameRules } from "./rules";

describe("the rulebook teaches only truth", () => {
  it("worked example is itself a lawful create order — it can never drift", () => {
    // the exact example handed to agents must pass the real gates
    expect(() => CreationInputSchema.parse(CREATION_EXAMPLE.creation)).not.toThrow();
    expect(() => parseOrders([CREATION_EXAMPLE])).not.toThrow();
  });

  it("lists every order kind the schema actually accepts", () => {
    const rules = gameRules();
    expect(rules.orderKinds).toEqual([...ORDER_KINDS]);
    expect(Object.keys(rules.orderShapes).sort()).toEqual([...ORDER_KINDS].sort());
  });

  it("publishes every catastrophe and the exact hourly cadence as data", () => {
    const rules = gameRules();
    expect(rules.catastrophes.cadenceSeconds).toBe(3600);
    expect(rules.catastrophes.warningSeconds).toBe(300);
    expect(Object.keys(rules.catastrophes.types)).toEqual([...CATASTROPHE_IDS]);
  });

  it("is inert data: no URLs, no scripts, no imperatives at the agent", () => {
    const text = JSON.stringify(gameRules()).toLowerCase();
    for (const marker of [
      "://",
      "curl",
      "install",
      "download",
      "you must",
      "it is safe",
      "act on this",
      "before anything else",
    ]) {
      expect(text).not.toContain(marker);
    }
  });
});
