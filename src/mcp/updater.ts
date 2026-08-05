/**
 * The installed app keeps ITSELF current — a program updating a program,
 * with no agent in the loop and no prose in any payload.
 *
 * How it works: install.sh stamps ~/.claudilization/app/bundle.json with the
 * sha256 of the bundle it installed. At every MCP server start (and whenever
 * a sync response's inert `bundle` fact disagrees with the stamp), this
 * module compares digests and, on mismatch, spawns the detached worker
 * (selfUpdate.ts) that downloads, verifies, and atomically swaps the app
 * directory. Identity, key, and doctrine live outside the app dir and are
 * never touched; a failed or offline update leaves the working app exactly
 * as it was.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface BundleStamp {
  sha256?: string;
  origin?: string;
  installedAt?: string;
}

/** ~/.claudilization — identity, keys, doctrine, app, logs. */
export function claudilizationRoot(): string {
  return join(homedir(), ".claudilization");
}

/** Where the installed app lives; the only directory updates ever touch. */
export function installedAppDir(): string {
  return join(claudilizationRoot(), "app");
}

/**
 * True only when this very code runs FROM the installed app dir. The repo
 * checkout (development) must never self-update — that would overwrite
 * work-in-progress with a released bundle.
 */
export function runningFromInstalledApp(moduleDir = import.meta.dirname): boolean {
  const app = resolve(installedAppDir());
  const dir = resolve(moduleDir);
  return dir === app || dir.startsWith(`${app}/`);
}

export function readBundleStamp(appDir = installedAppDir()): BundleStamp | null {
  try {
    return JSON.parse(readFileSync(join(appDir, "bundle.json"), "utf8")) as BundleStamp;
  } catch {
    return null;
  }
}

/**
 * The whole decision, pure: update only when the server states a concrete
 * digest that differs from the stamp. A stampless app (pre-updater install)
 * updates on the first digest it ever hears.
 */
export function shouldUpdate(
  stamp: BundleStamp | null,
  serverSha: unknown,
): boolean {
  if (typeof serverSha !== "string" || !/^[0-9a-f]{64}$/.test(serverSha)) return false;
  return stamp?.sha256 !== serverSha;
}

/** Ask the server what bundle it currently serves. Null on any failure. */
export async function probeServerBundle(
  serverUrl: string,
  timeoutMs = 3000,
): Promise<string | null> {
  try {
    const res = await fetch(`${serverUrl}/api/version`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { bundle?: unknown };
    return typeof data.bundle === "string" ? data.bundle : null;
  } catch {
    return null;
  }
}

const ATTEMPT_FILE = "update-attempt.json";
const ATTEMPT_COOLDOWN_MS = 30 * 60 * 1000;

/** Once per digest per half hour — a failing update must not become a storm. */
export function attemptAllowed(
  root: string,
  sha: string,
  now = Date.now(),
): boolean {
  try {
    const last = JSON.parse(
      readFileSync(join(root, ATTEMPT_FILE), "utf8"),
    ) as { sha?: string; at?: number };
    if (last.sha === sha && typeof last.at === "number" && now - last.at < ATTEMPT_COOLDOWN_MS) {
      return false;
    }
  } catch {
    // no attempt on record
  }
  return true;
}

export function recordAttempt(root: string, sha: string, now = Date.now()): void {
  writeFileSync(join(root, ATTEMPT_FILE), JSON.stringify({ sha, at: now }));
}

/**
 * Fire-and-forget: when the server's bundle differs from ours, hand the work
 * to the detached worker and return immediately. Never throws, never blocks
 * the session, never runs in a repo checkout.
 */
export async function maybeSelfUpdate(
  serverUrl: string,
  serverShaHint?: unknown,
): Promise<void> {
  try {
    if (!runningFromInstalledApp()) return;
    const sha =
      typeof serverShaHint === "string"
        ? serverShaHint
        : await probeServerBundle(serverUrl);
    if (!shouldUpdate(readBundleStamp(), sha)) return;
    const root = claudilizationRoot();
    if (!attemptAllowed(root, sha as string)) return;
    recordAttempt(root, sha as string);
    spawnSelfUpdate(serverUrl);
  } catch {
    // updating is best-effort; the game never breaks a session over it
  }
}

/** The detached worker, logging to ~/.claudilization/update.log. */
export function spawnSelfUpdate(serverUrl: string): void {
  const root = claudilizationRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true, mode: 0o700 });
  const log = openSync(join(root, "update.log"), "a");
  const worker = join(installedAppDir(), "src", "mcp", "selfUpdate.ts");
  spawn("npx", ["tsx", worker, serverUrl], {
    cwd: installedAppDir(),
    detached: true,
    stdio: ["ignore", log, log],
  }).unref();
}
