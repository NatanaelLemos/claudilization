/**
 * One-time player setup: prints (and with --write, installs) the pieces of
 * Claude Code config that wire this machine into the game:
 *   - the claudilization MCP server (join/sync tools)
 *   - the Stop hook (turn pulses + the decision step)
 *   - the /claudilization slash command (status, doctrine, rename, link)
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { claudilizationSkill } from "./slashCommand";

const repo = resolve(import.meta.dirname, "../..");
const hookCommand = `npx tsx ${join(repo, "src/mcp/hook.ts")}`;
const mcpCommand = { command: "npx", args: ["tsx", join(repo, "src/mcp/server.ts")] };

const mcpSnippet = {
  mcpServers: { claudilization: { ...mcpCommand } },
};
const hookEntry = {
  matcher: "",
  hooks: [{ type: "command", command: hookCommand }],
};

/** Write just the /claudilization command — what a self-update calls to keep
 * the player's own copy in step with the app, touching nothing else. */
function writeSkillFile(): string {
  const skillFile = join(homedir(), ".claude", "skills", "claudilization", "SKILL.md");
  mkdirSync(dirname(skillFile), { recursive: true, mode: 0o700 });
  writeFileSync(skillFile, claudilizationSkill(), { mode: 0o600 });
  chmodSync(skillFile, 0o600);
  return skillFile;
}

if (process.argv.includes("--skill-only")) {
  console.log(`✔ /claudilization command refreshed at ${writeSkillFile()}`);
} else if (process.argv.includes("--write")) {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  mkdirSync(dirname(settingsPath), { recursive: true, mode: 0o700 });
  const settings = existsSync(settingsPath)
    ? (JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>)
    : {};
  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
  const stops = (hooks.Stop ?? []) as unknown[];
  const already = JSON.stringify(stops).includes("claudilization") ||
    JSON.stringify(stops).includes(hookCommand);
  if (!already) {
    hooks.Stop = [...stops, hookEntry];
    settings.hooks = hooks;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
    chmodSync(settingsPath, 0o600);
    console.log(`✔ Stop hook installed in ${settingsPath}`);
  } else {
    console.log(`✔ Stop hook already installed`);
  }
  if (existsSync(settingsPath)) chmodSync(settingsPath, 0o600);
  console.log(`✔ /claudilization command installed at ${writeSkillFile()}`);
  console.log(`\nNow add the MCP server to Claude Code:`);
  console.log(`  claude mcp add claudilization -- npx tsx ${join(repo, "src/mcp/server.ts")}`);
} else {
  console.log(`Claudilization setup — two pieces of Claude Code config:\n`);
  console.log(`1) MCP server (add to .mcp.json or run \`claude mcp add\`):`);
  console.log(JSON.stringify(mcpSnippet, null, 2));
  console.log(`\n2) Stop hook (add to ~/.claude/settings.json under hooks.Stop):`);
  console.log(JSON.stringify({ hooks: { Stop: [hookEntry] } }, null, 2));
  console.log(`\nOr let me do it: npx tsx src/mcp/install.ts --write`);
}
