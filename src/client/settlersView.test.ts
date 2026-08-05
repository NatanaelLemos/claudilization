import { describe, expect, it } from "vitest";
import { spreadOffset } from "./settlersView";

describe("settler spread", () => {
  it("is deterministic, bounded, and distinct per settler — no more stacked dots", () => {
    const a1 = spreadOffset("island-1-s1");
    const a2 = spreadOffset("island-1-s1");
    expect(a1).toEqual(a2);

    const ids = Array.from({ length: 10 }, (_, i) => `island-1-s${i}`);
    const offsets = ids.map(spreadOffset);
    const distinct = new Set(offsets.map((o) => `${o.x.toFixed(3)},${o.z.toFixed(3)}`));
    expect(distinct.size).toBe(10);
    for (const o of offsets) {
      expect(Math.hypot(o.x, o.z)).toBeGreaterThan(0.3);
      expect(Math.hypot(o.x, o.z)).toBeLessThan(2.5);
    }
  });
});
