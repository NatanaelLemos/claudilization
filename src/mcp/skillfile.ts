/**
 * The player's skill file on disk — their civilization's ruling doctrine.
 * Written at join, read at every decision step. The pure logic (default
 * template, validation) lives in shared/skill so the browser editor uses
 * the exact same source.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { defaultSkill } from "../shared/skill";
import type { CivId } from "../shared/types";

export { defaultSkill, validateSkill } from "../shared/skill";

export function skillPath(): string {
  return join(homedir(), ".claudilization", "skill.md");
}

export function ensureDefaultSkill(civ: CivId): void {
  const path = skillPath();
  if (existsSync(path)) return;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  writeFileSync(path, defaultSkill(civ), { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function loadSkill(): string | null {
  const path = skillPath();
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
