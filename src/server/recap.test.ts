import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE } from "../shared/balance";
import type { GameEvent } from "../shared/types";
import { computeRecap } from "./recap";

const B = DEFAULT_BALANCE;

const feed: GameEvent[] = [
  { at: 100, type: "birth", text: "Livia was born", settler: "Livia", islandId: "i1" },
  { at: 200, type: "build-complete", text: "Marcus finished the granary", settler: "Marcus", islandId: "i1" },
  { at: 300, type: "death", text: "Gaius starved", settler: "Gaius", islandId: "i1" },
];

describe("the while-you-were-gone recap", () => {
  it("appears after more than 30 minutes away with news — and tells it by name", () => {
    const recap = computeRecap(feed, 50, 50 + B.recapAwaySeconds + 60, B)!;
    expect(recap).not.toBeNull();
    expect(recap.events).toHaveLength(3);
    for (const name of ["Livia", "Marcus", "Gaius"]) {
      expect(recap.line).toContain(name);
    }
  });

  it("stays silent for a short absence", () => {
    expect(computeRecap(feed, 50, 50 + B.recapAwaySeconds - 30, B)).toBeNull();
  });

  it("stays silent when nothing happened", () => {
    const recap = computeRecap(feed, 400, 400 + B.recapAwaySeconds + 60, B);
    expect(recap).toBeNull();
  });

  it("only recaps what happened since the player last looked", () => {
    const recap = computeRecap(feed, 150, 150 + B.recapAwaySeconds + 60, B)!;
    expect(recap.events).toHaveLength(2);
    expect(recap.line).not.toContain("Livia");
  });
});
