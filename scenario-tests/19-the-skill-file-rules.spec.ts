// Behavior 19: joining writes the civilization's default skill file; every
// sync reads it (custom doctrine reaches the decision step); an invalid file
// is set aside, never obeyed.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { mcpSession } from "./helpers/driver";

test("the skill file is written at join, read at sync, and validated", async () => {
  const mcp = await mcpSession();
  try {
    const reply = await mcp.callText("join", { civilization: "aztec" });
    expect(reply).toContain("skill.md");

    const skillPath = joinPath(mcp.home, ".claudilization", "skill.md");
    const written = readFileSync(skillPath, "utf8");
    expect(written.toLowerCase()).toContain("aztec");
    expect(written.toLowerCase()).toContain("food");

    // the player rewrites their doctrine — the next decision step sees it
    const doctrine = "Send two settlers to wood before anything else.";
    writeFileSync(skillPath, doctrine);
    const sync = await mcp.callText("sync", {});
    expect(sync).toContain(doctrine);
    expect(sync.toLowerCase()).toContain("server law");

    // a bloated file is set aside with the reason, not obeyed
    writeFileSync(skillPath, "x".repeat(5000));
    const rejected = await mcp.callText("sync", {});
    expect(rejected.toLowerCase()).toContain("set aside");
    expect(rejected).not.toContain("x".repeat(100));
  } finally {
    await mcp.close();
  }
});
