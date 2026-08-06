import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_BALANCE } from "../shared/balance";
import { FileStore, Persistence, type WorldCommand } from "./persistence";
import { World } from "./world";

let dir: string;
beforeEach(() => {
  mkdirSync("data", { recursive: true });
  dir = mkdtempSync(join("data", "test-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const open = () => Persistence.open(new FileStore(dir));

/** Apply a command to the live world and record it, exactly as the server does. */
async function run(w: World, p: Persistence, cmd: WorldCommand) {
  await p.record(cmd);
  if (cmd.type === "join") w.join({ civ: cmd.civ as never, secret: cmd.secret });
  if (cmd.type === "pulse") w.pulse(cmd.secret, cmd.tokens);
  if (cmd.type === "orders") w.applyOrders(cmd.secret, cmd.orders as never);
  if (cmd.type === "rename") w.rename(cmd.secret, cmd.name);
  if (cmd.type === "grant") w.debugGrant(cmd.islandId, cmd.grant as never);
  if (cmd.type === "rebalance") w.rebalance(cmd.balance);
}

describe("persistence — no progress is ever lost", () => {
  it("the snapshot cadence honours the 5-minute contract", () => {
    expect(DEFAULT_BALANCE.snapshotIntervalSeconds).toBeLessThanOrEqual(300);
  });

  it("restores an identical world from the command log alone", async () => {
    const p = await open();
    const w = World.create({ seed: 55 });
    await p.record({ type: "create", at: 0, seed: 55, catastropheEpoch: 0 });
    await run(w, p, { type: "join", at: 0, civ: "roman", secret: "s1" });
    await run(w, p, { type: "pulse", at: 0, secret: "s1", tokens: 9000 });
    w.tick(30);
    await run(w, p, {
      type: "orders",
      at: 30,
      secret: "s1",
      orders: [{ kind: "assign_gathering", resource: "wood", count: 3 }],
    });
    await run(w, p, { type: "rename", at: 30, secret: "s1", name: "Nova Roma" });
    w.tick(10);

    const restored = (await (await open()).restore())!;
    restored.tick(40 - restored.time > 0 ? 40 - restored.time : 0);
    expect(restored.serialize()).toBe(w.serialize());
  });

  it("a snapshot plus the log tail restores the same world as the full log", async () => {
    const p = await open();
    const w = World.create({ seed: 55 });
    await p.record({ type: "create", at: 0, seed: 55, catastropheEpoch: 0 });
    await run(w, p, { type: "join", at: 0, civ: "aztec", secret: "s1" });
    w.tick(20);
    await p.maybeSnapshot(w);
    await run(w, p, { type: "pulse", at: 20, secret: "s1", tokens: 4000 });
    w.tick(20);

    const restored = (await (await open()).restore())!;
    restored.tick(40 - restored.time > 0 ? 40 - restored.time : 0);
    expect(restored.serialize()).toBe(w.serialize());
  });

  it("a rebalance in the log tail carries the new law through restore", async () => {
    const p = await open();
    const w = World.create({ seed: 55, balance: { daySeconds: 120 } });
    await p.record({
      type: "create",
      at: 0,
      seed: 55,
      balance: { daySeconds: 120 },
      catastropheEpoch: 0,
    });
    await run(w, p, { type: "join", at: 0, civ: "roman", secret: "s1" });
    w.tick(20);
    await p.maybeSnapshot(w); // snapshot still carries the fast clock
    await run(w, p, { type: "rebalance", at: 20, balance: { daySeconds: 3600 } });
    w.tick(20);

    const restored = (await (await open()).restore())!;
    expect(restored.law.daySeconds).toBe(3600);
    restored.tick(40 - restored.time > 0 ? 40 - restored.time : 0);
    expect(restored.serialize()).toBe(w.serialize());
  });

  it("replays a legacy activation epoch without inventing catastrophes before it", async () => {
    const p = await open();
    await p.record({
      type: "create",
      at: 0,
      seed: 55,
      balance: {
        catastropheIntervalSeconds: 20,
        catastropheWarningSeconds: 5,
        catastropheDurationSeconds: 2,
      },
    });
    await p.record({ type: "catastrophes", at: 100, epoch: 100 });
    const restored = (await (await open()).restore())!;
    expect(restored.time).toBe(100);
    expect(restored.catastropheNeedsActivation).toBe(false);
    expect(restored.catastrophe.nextAt).toBe(120);
    expect(restored.tick(19).filter((event) => event.type === "catastrophe-start")).toHaveLength(0);
    expect(restored.tick(1).filter((event) => event.type === "catastrophe-start")).toHaveLength(1);
  });

  it("restore returns null on an empty directory", async () => {
    expect(await (await open()).restore()).toBeNull();
  });
});
