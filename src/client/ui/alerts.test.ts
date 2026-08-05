import { describe, expect, it } from "vitest";
import type { GameEvent } from "../../shared/types";
import { attackAlertModel } from "./alerts";

const bell = (over: Partial<GameEvent> = {}): GameEvent => ({
  at: 100,
  type: "under-attack",
  text: "Sparta is being attacked by Karakorum!",
  islandId: "island-2",
  attackerId: "island-1",
  world: true,
  ...over,
});

const summaries = new Map([
  ["island-1", { name: "Karakorum", color: "#c0392b" }],
  ["island-2", { name: "Sparta", color: "#2980b9" }],
]);
const lookup = (id: string) => summaries.get(id);

describe("attackAlertModel — the card out of the raw event", () => {
  it("names both sides in their banner colors and points at the defender", () => {
    const m = attackAlertModel(bell(), lookup)!;
    expect(m).toBeTruthy();
    expect(m.defenderId).toBe("island-2");
    expect(m.defender).toEqual({ name: "Sparta", color: "#2980b9" });
    expect(m.attacker).toEqual({ name: "Karakorum", color: "#c0392b" });
  });

  it("keys one card per attacker→defender pair", () => {
    const m = attackAlertModel(bell(), lookup)!;
    expect(m.key).toBe("island-1>island-2");
    // the same pair again produces the same key — the card refreshes, not stacks
    expect(attackAlertModel(bell(), lookup)!.key).toBe(m.key);
    // a different aggressor is a different card
    expect(attackAlertModel(bell({ attackerId: "island-3" }), lookup)!.key).toBe(
      "island-3>island-2",
    );
  });

  it("still reads when a summary has not landed yet", () => {
    const m = attackAlertModel(bell({ attackerId: "island-9", islandId: "island-8" }), lookup)!;
    expect(m.defender.name).toBe("A distant colony");
    expect(m.attacker.name).toBe("unknown raiders");
    expect(m.defender.color).toBeUndefined();
  });

  it("ignores every other kind of event", () => {
    expect(attackAlertModel(bell({ type: "conquest" }), lookup)).toBeNull();
    expect(attackAlertModel(bell({ type: "raid-repelled" }), lookup)).toBeNull();
    expect(attackAlertModel(bell({ islandId: undefined }), lookup)).toBeNull();
  });
});
