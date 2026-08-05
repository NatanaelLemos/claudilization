/**
 * The identity-preservation law, as a test that FAILS if any install or
 * update path ever touches a player's identity: identity.json, key.pem, and
 * skill.md live beside the app directory and must survive every update
 * byte-for-byte. Losing identity.json is how an island gets orphaned; a
 * rewritten key.pem would sever the owner handshake forever.
 *
 * Two halves:
 *  1. the self-updater (selfUpdate.ts) runs FOR REAL against a local fixture
 *     server, with a full identity tree in place — every file outside the
 *     app directories must come out byte-identical, and the stamp must land;
 *  2. the served install.sh is held to a static law: it may only ever delete
 *     or move its own temp/app directories, and must never name identity
 *     files at all.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSelfUpdate } from "./selfUpdate";
import { readBundleStamp } from "./updater";

let scratch: string | null = null;
const realHome = process.env.HOME;

afterEach(() => {
  process.env.HOME = realHome;
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

/** Every file under `dir` except the app dirs and the updater's own files. */
function identityTreeHashes(dir: string): Map<string, string> {
  const skip = new Set(["app", "app.next", "app.prev", "update.log", "update-attempt.json", "update.lock"]);
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (d === dir && skip.has(entry.name)) continue;
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else out.set(relative(dir, p), createHash("sha256").update(readFileSync(p)).digest("hex"));
    }
  };
  walk(dir);
  return out;
}

describe("the self-updater never touches identity", () => {
  it("updates the app while identity.json, key.pem, and skill.md stay byte-identical", async () => {
    scratch = mkdtempSync(join(tmpdir(), "clz-identity-"));
    process.env.HOME = scratch;
    const root = join(scratch, ".claudilization");
    const app = join(root, "app");

    // a player's full identity tree, plus an old app worth replacing
    mkdirSync(join(app, "src", "mcp"), { recursive: true });
    writeFileSync(join(root, "identity.json"), '{"secret":"s-test","serverUrl":"x"}\n');
    writeFileSync(join(root, "key.pem"), "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n");
    writeFileSync(join(root, "skill.md"), "# doctrine: hold the line\n");
    writeFileSync(join(app, "src", "mcp", "server.ts"), "// OLD APP\n");
    writeFileSync(join(app, "bundle.json"), `{"sha256":"${"0".repeat(64)}"}\n`);

    // the fixture bundle the server will serve — a complete tiny app
    const fixture = mkdtempSync(join(tmpdir(), "clz-fixture-"));
    mkdirSync(join(fixture, "src", "mcp"), { recursive: true });
    writeFileSync(join(fixture, "src", "mcp", "server.ts"), "// NEW APP\n");
    writeFileSync(join(fixture, "package.json"), '{"name":"clz-fixture","version":"1.0.0","private":true}\n');
    writeFileSync(
      join(fixture, "package-lock.json"),
      '{"name":"clz-fixture","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"clz-fixture","version":"1.0.0"}}}\n',
    );
    const tgz = join(fixture, "bundle.tgz");
    const tar = spawnSync("tar", ["-czf", tgz, "-C", fixture, "src", "package.json", "package-lock.json"]);
    expect(tar.status).toBe(0);
    const bytes = readFileSync(tgz);
    const digest = createHash("sha256").update(bytes).digest("hex");

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/api/version") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ bundle: digest }));
      } else if (req.url === "/claudilization.tgz") {
        res.end(bytes);
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    const before = identityTreeHashes(root);
    expect(before.size).toBeGreaterThanOrEqual(3);
    try {
      await runSelfUpdate(`http://127.0.0.1:${port}`);
    } finally {
      server.close();
      rmSync(fixture, { recursive: true, force: true });
    }

    // the update LANDED…
    expect(readBundleStamp(app)?.sha256).toBe(digest);
    expect(readFileSync(join(app, "src", "mcp", "server.ts"), "utf8")).toContain("NEW APP");
    expect(readFileSync(join(root, "app.prev", "src", "mcp", "server.ts"), "utf8")).toContain("OLD APP");
    // …and the identity tree is byte-for-byte what it was
    expect(identityTreeHashes(root)).toEqual(before);
  }, 120_000);
});

describe("install.sh is held to the identity law", () => {
  it("only ever deletes or moves its own directories, and never names identity files", async () => {
    // the script exactly as the server serves it (api.test.ts boots a full
    // server; here the template alone is the law being audited)
    const { installScriptForTest } = await import("../server/api");
    const script = installScriptForTest("https://claudilization.example", "f".repeat(64));

    // identity files are never even mentioned
    for (const name of ["identity.json", "key.pem", "skill.md", "brain"]) {
      expect(script).not.toContain(name);
    }

    // every rm -rf names one of the installer's own three targets
    const removals = [...script.matchAll(/rm -rf\s+("[^"]+"|\S+)/g)].map((m) => m[1]);
    expect(removals.length).toBeGreaterThan(0);
    for (const target of removals) {
      expect(['"$TMP"', '"$NEXT"', '"$ROOT/app.prev"']).toContain(target);
    }

    // the only moves are the atomic swap pair
    const moves = [...script.matchAll(/\bmv\s+("[^"]+")\s+("[^"]+")/g)].map(
      (m) => `${m[1]} ${m[2]}`,
    );
    expect(moves).toEqual(['"$APP" "$ROOT/app.prev"', '"$NEXT" "$APP"']);

    // the stamp is written into app.next BEFORE the swap makes it live
    const stampAt = script.indexOf('bundle.json');
    const swapAt = script.indexOf('mv "$NEXT" "$APP"');
    expect(stampAt).toBeGreaterThan(0);
    expect(stampAt).toBeLessThan(swapAt);

    // nothing world-writable comes out of this script
    expect(script).toContain("umask 077");
  });
});
