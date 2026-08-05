// Behavior 16: the world survives a hard kill and restart with progress intact.
import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { TEST_WORK } from "./helpers/driver";

const PORT = 8791;
const BASE = `http://localhost:${PORT}`;
const DATA = `${TEST_WORK}/durability-data`;

function startServer(): ChildProcess {
  // detached → own process group, so stopServer can kill npx AND the actual
  // node server underneath it (a bare child.kill orphans the server)
  return spawn("npx", ["tsx", "src/server/main.ts"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      CLAUDILIZATION_HOST: "127.0.0.1",
      // Never let an ambient operator DATABASE_URL turn a scenario into a
      // production database test.
      CLAUDILIZATION_DB: "",
      DATABASE_URL: "",
      CLAUDILIZATION_DATA: DATA,
      CLAUDILIZATION_TEST: "1",
      CLAUDILIZATION_SEED: "77",
    },
    stdio: "ignore",
    detached: true,
  });
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(resolve, 5_000).unref();
  });
  try {
    process.kill(-child.pid!, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
  await exited;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function portFree(): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE}/api/world`, { signal: AbortSignal.timeout(500) });
    } catch {
      return; // connection refused — port is ours
    }
    await sleep(300);
  }
  throw new Error("port 8791 still occupied by a leftover server");
}

async function up(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/world`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(400);
  }
  throw new Error("durability server never came up");
}

test("a hard kill loses nothing that was recorded", async () => {
  test.setTimeout(120_000);
  rmSync(DATA, { recursive: true, force: true });
  await portFree();
  let server = startServer();
  try {
    await up();
    const join = await (
      await fetch(`${BASE}/api/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ civ: "egyptian" }),
      })
    ).json();
    expect(join.secret).toBeTruthy();
    for (const tokens of [4000, 9000, 2000]) {
      await fetch(`${BASE}/api/pulse`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: join.secret, tokens }),
      });
    }
    await fetch(`${BASE}/api/debug/grant`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ islandId: join.islandId, grant: { stocks: { wood: 777 } } }),
    });
    const before = await (
      await fetch(`${BASE}/api/state?secret=${join.secret}`)
    ).json();
    expect(before.island.stocks.wood).toBe(777);
    const workBefore = before.island.workPoints;
    const timeBefore = before.time ?? 0;

    await stopServer(server);
    await portFree();

    server = startServer();
    await up();
    const after = await (
      await fetch(`${BASE}/api/state?secret=${join.secret}`)
    ).json();
    expect(after.island.name).toBe(join.islandName);
    // the world's clock is the wall clock, so the seconds the process was dead
    // are lived, not skipped: the woodcutters keep cutting. What durability
    // promises is that nothing *recorded* is lost — the grant is still there,
    // underneath whatever the town has earned since.
    expect(after.island.stocks.wood).toBeGreaterThanOrEqual(777);
    expect(after.island.workPoints).toBeGreaterThanOrEqual(workBefore);
    expect(after.island.settlers).toHaveLength(10);
    // and the clock came back at the true hour rather than where it was killed
    if (after.time !== undefined) expect(after.time).toBeGreaterThan(timeBefore);
  } finally {
    await stopServer(server);
  }
});
