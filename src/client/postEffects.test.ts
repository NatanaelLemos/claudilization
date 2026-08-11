import { describe, expect, it } from "vitest";
import { POST_MARKER, postEnabled, tiltShiftEnabled } from "./postEffects";

describe("miniature post pass", () => {
  it("ships a stable marker for live-bundle verification", () => {
    expect(POST_MARKER).toBe("tilt-shift-post-v1");
  });

  it("keeps the grade on every desktop tier, off phones and reduced motion", () => {
    expect(postEnabled("high", false, false)).toBe(true);
    // a slower machine keeps the look; only the defocus band is dropped
    expect(postEnabled("balanced", false, false)).toBe(true);
    expect(postEnabled("performance", false, false)).toBe(true);
    // phones never pay for the pass
    expect(postEnabled("high", true, false)).toBe(false);
    // reduced motion renders direct
    expect(postEnabled("high", false, true)).toBe(false);
  });

  it("spends the defocus band only at full desktop quality", () => {
    expect(tiltShiftEnabled("high", false, false)).toBe(true);
    expect(tiltShiftEnabled("balanced", false, false)).toBe(false);
    expect(tiltShiftEnabled("performance", false, false)).toBe(false);
    expect(tiltShiftEnabled("high", true, false)).toBe(false);
    expect(tiltShiftEnabled("high", false, true)).toBe(false);
  });
});
