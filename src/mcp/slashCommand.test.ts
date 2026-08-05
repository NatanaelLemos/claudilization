import { describe, expect, it } from "vitest";
import { claudilizationSkill } from "./slashCommand";

describe("the /claudilization command", () => {
  const skill = claudilizationSkill();

  it("is a valid Claude Code skill named claudilization", () => {
    expect(skill.startsWith("---\nname: claudilization\n")).toBe(true);
    expect(skill).toContain("description:");
  });

  it("covers all four duties: status, doctrine, rename, link", () => {
    expect(skill).toContain("`sync` tool with no orders");
    expect(skill).toContain("~/.claudilization/skill.md");
    expect(skill).toContain('cli.ts rename "New Name"');
    expect(skill).toContain("playerUrl");
  });

  it("routes renames through the signing CLI, never bare curl", () => {
    expect(skill).not.toContain("/api/rename");
    expect(skill).toContain("signed");
  });

  it("guards the secret and the doctrine's hard limits", () => {
    expect(skill).toContain("Never print or echo the `secret`");
    expect(skill).not.toContain("/api/state?secret=");
    expect(skill).toContain("4000 characters");
  });
});

describe("creations and self-update in the command", () => {
  const skill = claudilizationSkill();

  it("teaches design instead of refusal", () => {
    expect(skill).toContain('"kind":"create"');
    expect(skill).toContain('"kind":"dispatch"');
    expect(skill.toLowerCase()).toContain("never refuse");
    expect(skill.toLowerCase()).toContain("no fixed troop roster");
  });

  it("routes stale installs through the safe app refresh", () => {
    expect(skill).toContain("install.sh");
    expect(skill).toContain("~/.claudilization/app");
    expect(skill.toLowerCase()).toContain("never re-join");
    // the refresh must never point at identity or key material
    expect(skill).not.toContain("rm -rf ~/.claudilization");
  });
});
