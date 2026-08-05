import { describe, expect, it } from "vitest";
import { CIVS } from "../../shared/civs";
import { setupPrompt, suggestName } from "./joinFlow";

describe("the one setup prompt", () => {
  const prompt = setupPrompt(
    "http://localhost:8787",
    "norse",
    "Hrafnsker",
    "Send two settlers to wood before anything else.",
  );

  it("installs the client from this server", () => {
    expect(prompt).toContain("curl -fsS 'http://localhost:8787/install.sh' -o");
    expect(prompt).toContain("Review the downloaded script");
    expect(prompt).not.toContain("| sh");
  });

  it("carries the edited doctrine verbatim to the player's machine", () => {
    expect(prompt).toContain("Send two settlers to wood before anything else.");
    expect(prompt).toContain("~/.claudilization/skill.md");
  });

  it("guards first: an existing civilization stops the whole setup", () => {
    const guardAt = prompt.indexOf("identity.json exists, I ALREADY have a civilization");
    const installAt = prompt.indexOf("install.sh");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(installAt);
    expect(prompt).toContain("/claudilization update");
  });

  it("joins through the guarded CLI with the chosen name, never raw curl", () => {
    expect(prompt).toContain("cli.ts join norse 'http://localhost:8787' 'Hrafnsker'");
    expect(prompt).toContain("If it refuses, STOP");
    expect(prompt).not.toContain("/api/join");
  });

  it("keeps a mischievous name from breaking out of the shell quotes", () => {
    const p = setupPrompt("http://x", "roman", "Isla ' $(touch /tmp/pwned)", "doctrine");
    expect(p).toContain(`join roman 'http://x' 'Isla '"'"' $(touch /tmp/pwned)'`);
  });

  it("ends by handing the player their island name and personal link", () => {
    expect(prompt.toLowerCase()).toContain("personal link");
  });
});

describe("suggestName — every people offers a name in its own tongue", () => {
  it("draws from the chosen civilization's bank", () => {
    expect(CIVS.norse.islandNames).toContain(suggestName("norse", 0.4));
    expect(CIVS.aztec.islandNames).toContain(suggestName("aztec", 0.99));
    expect(suggestName("greek", 0)).toBe(CIVS.greek.islandNames[0]);
  });
});
