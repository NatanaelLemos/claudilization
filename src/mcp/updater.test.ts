import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireLock, releaseLock, swapAppDirs } from "./selfUpdate";
import {
  attemptAllowed,
  readBundleStamp,
  recordAttempt,
  runningFromInstalledApp,
  shouldUpdate,
} from "./updater";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

let scratch: string | null = null;
function tmp(): string {
  scratch = mkdtempSync(join(tmpdir(), "clz-updater-"));
  return scratch;
}
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

describe("the update decision — pure and conservative", () => {
  it("updates only on a concrete digest that differs from the stamp", () => {
    expect(shouldUpdate({ sha256: SHA_A }, SHA_B)).toBe(true);
    expect(shouldUpdate({ sha256: SHA_A }, SHA_A)).toBe(false);
  });

  it("a stampless (pre-updater) app updates on the first digest it hears", () => {
    expect(shouldUpdate(null, SHA_A)).toBe(true);
  });

  it("never updates toward silence or garbage", () => {
    expect(shouldUpdate({ sha256: SHA_A }, null)).toBe(false);
    expect(shouldUpdate({ sha256: SHA_A }, undefined)).toBe(false);
    expect(shouldUpdate({ sha256: SHA_A }, "not-a-digest")).toBe(false);
    expect(shouldUpdate({ sha256: SHA_A }, 42)).toBe(false);
  });
});

describe("bundle stamps", () => {
  it("reads the stamp install.sh writes", () => {
    const dir = tmp();
    writeFileSync(
      join(dir, "bundle.json"),
      `{"sha256":"${SHA_A}","origin":"https://claudilization.com"}\n`,
    );
    expect(readBundleStamp(dir)).toEqual({
      sha256: SHA_A,
      origin: "https://claudilization.com",
    });
  });

  it("a missing or corrupt stamp reads as null, never throws", () => {
    const dir = tmp();
    expect(readBundleStamp(dir)).toBeNull();
    writeFileSync(join(dir, "bundle.json"), "not json");
    expect(readBundleStamp(dir)).toBeNull();
  });
});

describe("attempt cooldown — a failing update never becomes a storm", () => {
  it("allows the first attempt, then blocks the same digest for a while", () => {
    const root = tmp();
    expect(attemptAllowed(root, SHA_A)).toBe(true);
    recordAttempt(root, SHA_A);
    expect(attemptAllowed(root, SHA_A)).toBe(false);
    // a DIFFERENT digest is a new world version — always worth an attempt
    expect(attemptAllowed(root, SHA_B)).toBe(true);
    // and the cooldown expires
    expect(attemptAllowed(root, SHA_A, Date.now() + 31 * 60 * 1000)).toBe(true);
  });
});

describe("repo checkouts never self-update", () => {
  it("recognizes this very test run as NOT the installed app", () => {
    expect(runningFromInstalledApp()).toBe(false);
  });
});

describe("the atomic swap", () => {
  it("promotes app.next and keeps the old app as app.prev", () => {
    const root = tmp();
    mkdirSync(join(root, "app"));
    writeFileSync(join(root, "app", "marker"), "old");
    mkdirSync(join(root, "app.next"));
    writeFileSync(join(root, "app.next", "marker"), "new");
    swapAppDirs(root);
    expect(readMarker(root, "app")).toBe("new");
    expect(readMarker(root, "app.prev")).toBe("old");
  });

  it("rolls the old app back when the new one cannot take its place", () => {
    const root = tmp();
    mkdirSync(join(root, "app"));
    writeFileSync(join(root, "app", "marker"), "old");
    // no app.next at all — the second rename must fail
    expect(() => swapAppDirs(root)).toThrow();
    expect(readMarker(root, "app")).toBe("old");
  });
});

describe("the update lock", () => {
  it("is exclusive, reclaims stale locks, and releases cleanly", () => {
    const root = tmp();
    expect(acquireLock(root)).toBe(true);
    expect(acquireLock(root)).toBe(false);
    // a crashed worker's lock goes stale and is reclaimed
    const lock = join(root, "update.lock");
    const old = new Date(Date.now() - 16 * 60 * 1000);
    utimesSync(lock, old, old);
    expect(acquireLock(root)).toBe(true);
    releaseLock(root);
    expect(acquireLock(root)).toBe(true);
  });
});

function readMarker(root: string, dir: string): string {
  return readFileSync(join(root, dir, "marker"), "utf8");
}
