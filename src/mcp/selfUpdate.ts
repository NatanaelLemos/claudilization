/**
 * The detached update worker: download the server's current bundle, verify
 * its digest, build a complete replacement app beside the live one, then
 * swap directories. The live app is only ever touched by two renames at the
 * very end — any failure before that leaves it byte-for-byte as it was, and
 * the previous app survives as ~/.claudilization/app.prev until the NEXT
 * successful update.
 *
 * Run as: tsx selfUpdate.ts <serverUrl>   (spawned by updater.ts, detached)
 *
 * This file must stay self-sufficient at run time: it executes from the OLD
 * app directory, which gets renamed away mid-run — so every import is static
 * (loaded before the swap) and nothing re-reads its own source afterwards.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { claudilizationRoot, installedAppDir, readBundleStamp } from "./updater";

const LOCK_STALE_MS = 15 * 60 * 1000;

function log(root: string, line: string): void {
  appendFileSync(join(root, "update.log"), `${new Date().toISOString()} ${line}\n`);
}

/** mkdir-as-mutex; a crashed worker's lock goes stale and is reclaimed. */
export function acquireLock(root: string, now = Date.now()): boolean {
  const lock = join(root, "update.lock");
  try {
    mkdirSync(lock);
    return true;
  } catch {
    try {
      if (now - statSync(lock).mtimeMs > LOCK_STALE_MS) {
        rmSync(lock, { recursive: true, force: true });
        mkdirSync(lock);
        return true;
      }
    } catch {
      // raced another worker — let it win
    }
    return false;
  }
}

export function releaseLock(root: string): void {
  rmSync(join(root, "update.lock"), { recursive: true, force: true });
}

/**
 * The two renames that make an update land, with rollback: if the new app
 * cannot take its place, the old one is put back before the error surfaces.
 */
export function swapAppDirs(root: string): void {
  const app = join(root, "app");
  const next = join(root, "app.next");
  const prev = join(root, "app.prev");
  rmSync(prev, { recursive: true, force: true });
  renameSync(app, prev);
  try {
    renameSync(next, app);
  } catch (err) {
    renameSync(prev, app); // the old app returns; nothing was lost
    throw err;
  }
}

export async function runSelfUpdate(serverUrl: string): Promise<void> {
  const root = claudilizationRoot();
  const app = installedAppDir();
  const next = join(root, "app.next");
  if (!acquireLock(root)) {
    log(root, "another update is already running — leaving it to finish");
    return;
  }
  try {
    // 1. what does the server serve, and do we already have it?
    const versionRes = await fetch(`${serverUrl}/api/version`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!versionRes.ok) throw new Error(`version probe failed: ${versionRes.status}`);
    const { bundle } = (await versionRes.json()) as { bundle?: unknown };
    if (typeof bundle !== "string" || !/^[0-9a-f]{64}$/.test(bundle)) {
      log(root, "server states no bundle digest — nothing to update to");
      return;
    }
    if (readBundleStamp(app)?.sha256 === bundle) {
      log(root, `already current (${bundle.slice(0, 12)})`);
      return;
    }
    log(root, `updating to bundle ${bundle.slice(0, 12)} from ${serverUrl}`);

    // 2. download and verify — the digest is the whole trust decision
    const tgzRes = await fetch(`${serverUrl}/claudilization.tgz`, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!tgzRes.ok) throw new Error(`bundle download failed: ${tgzRes.status}`);
    const bytes = Buffer.from(await tgzRes.arrayBuffer());
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== bundle) {
      throw new Error(`digest mismatch: expected ${bundle.slice(0, 12)}, got ${actual.slice(0, 12)}`);
    }

    // 3. build the complete replacement beside the live app
    rmSync(next, { recursive: true, force: true });
    mkdirSync(next, { recursive: true, mode: 0o700 });
    const tgzPath = join(next, "claudilization.tgz");
    writeFileSync(tgzPath, bytes);
    const untar = spawnSync("tar", ["-xzf", tgzPath, "-C", next], { timeout: 60_000 });
    if (untar.status !== 0) throw new Error("bundle extraction failed");
    rmSync(tgzPath, { force: true });
    const npm = spawnSync(
      "npm",
      ["ci", "--omit=dev", "--no-fund", "--no-audit", "--loglevel=error"],
      { cwd: next, timeout: 10 * 60 * 1000, stdio: "ignore" },
    );
    if (npm.status !== 0) throw new Error("npm ci failed in the new app");
    if (!existsSync(join(next, "src", "mcp", "server.ts"))) {
      throw new Error("new app is missing its MCP server");
    }
    writeFileSync(
      join(next, "bundle.json"),
      `${JSON.stringify({ sha256: bundle, origin: serverUrl, installedAt: new Date().toISOString() })}\n`,
    );

    // 4. the swap — the only moment the live app is touched
    swapAppDirs(root);
    log(root, `updated to bundle ${bundle.slice(0, 12)} — previous app kept at app.prev`);
  } catch (err) {
    rmSync(next, { recursive: true, force: true });
    log(root, `update failed, app untouched: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    releaseLock(root);
  }
}

// entry point when spawned as a worker (never during tests' imports)
const invokedDirectly = process.argv[1]?.endsWith("selfUpdate.ts") ?? false;
if (invokedDirectly) {
  const serverUrl = process.argv[2];
  if (!serverUrl) {
    console.error("usage: tsx selfUpdate.ts <serverUrl>");
    process.exit(2);
  }
  await runSelfUpdate(serverUrl);
}
