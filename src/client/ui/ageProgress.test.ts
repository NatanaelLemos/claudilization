import { describe, expect, it } from "vitest";
import { advanceRequirements } from "../../shared/ages";
import { DEFAULT_BALANCE } from "../../shared/balance";
import { ageProgress } from "./ageProgress";

describe("ageProgress — the road to the next age", () => {
  it("names the next age and measures the work already banked", () => {
    const need = Math.ceil(advanceRequirements("medieval", DEFAULT_BALANCE));
    const p = ageProgress({ age: "classical", workPoints: need / 2 })!;
    expect(p.next).toBe("medieval");
    expect(p.need).toBe(need);
    expect(p.share).toBeCloseTo(0.5, 1);
  });

  it("clamps the bar at full when the requirement is already met", () => {
    const need = Math.ceil(advanceRequirements("bronze", DEFAULT_BALANCE));
    const p = ageProgress({ age: "stone", workPoints: need * 3 })!;
    expect(p.share).toBe(1);
  });

  it("goes quiet at the final age — the future is the horizon", () => {
    expect(ageProgress({ age: "future", workPoints: 1e9 })).toBeNull();
  });
});
