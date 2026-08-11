import { describe, expect, it } from "vitest";
import { POST_MARKER, postEnabled } from "./postEffects";

describe("miniature post pass", () => {
  it("ships a stable marker for live-bundle verification", () => {
    expect(POST_MARKER).toBe("tilt-shift-post-v1");
  });

  it("runs only on desktop, at full quality, without reduced motion", () => {
    expect(postEnabled("high", false, false)).toBe(true);
    // phones never pay for the pass
    expect(postEnabled("high", true, false)).toBe(false);
    // reduced motion renders direct
    expect(postEnabled("high", false, true)).toBe(false);
    // adaptive quality downgrades switch the pass off before anything else
    expect(postEnabled("balanced", false, false)).toBe(false);
    expect(postEnabled("performance", false, false)).toBe(false);
  });
});
