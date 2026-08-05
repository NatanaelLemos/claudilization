import { describe, expect, it } from "vitest";
import { updatePrompt } from "./updateFlow";

describe("the update prompt", () => {
  it("carries the doctrine verbatim and forbids re-joining", () => {
    const p = updatePrompt("Kagerou", "Kagerou", "# My rules\n- favor boats");
    expect(p).toContain("# My rules\n- favor boats");
    expect(p).toContain("Never POST /api/join");
    expect(p).toContain("overwrite ~/.claudilization/skill.md");
    expect(p).toContain("---SKILL---");
  });

  it("leaves the name alone when it did not change", () => {
    const p = updatePrompt("Kagerou", "Kagerou", "# rules");
    expect(p).not.toContain("cli.ts rename");
  });

  it("adds the signed rename step only when the name changed", () => {
    const p = updatePrompt("Kagerou", "Shinsekai", "# rules");
    expect(p).toContain('cli.ts rename "Shinsekai"');
    expect(p).toContain("Never POST /api/join");
  });
});
