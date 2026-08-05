import { describe, expect, it } from "vitest";
import { dayAnchorMs, isNight, secondsIntoDay, worldSecondsAt } from "../shared/daylight";
import { World } from "./world";

/**
 * The world's clock is the wall clock.
 *
 * It used to be a tally: `setInterval` added one second, every second, and the
 * total was snapshotted. Every restart lost whatever had happened since the
 * last snapshot, every busy second lost a fraction, and the losses never came
 * back — so an "hour-long" island day quietly ran long, and no spectator could
 * be told what time it was without asking the server what it had counted.
 * These tests hold the clock to the only definition that cannot drift.
 */

const LAW = { daySeconds: 100, daylightShare: 0.5 };
const at = (iso: string) => Date.parse(iso);

function bornAt(nowMs: number, balance = LAW) {
  const anchorMs = dayAnchorMs(nowMs, balance.daySeconds);
  return World.create({
    seed: 7,
    balance,
    anchorMs,
    at: worldSecondsAt(nowMs, anchorMs),
  });
}

describe("the world's clock is the wall clock", () => {
  it("is born at the true time of day, not at an arbitrary dawn", () => {
    const w = bornAt(at("2026-08-04T20:00:37Z"));
    expect(w.time).toBe(37);
    expect(secondsIntoDay(w.time, LAW.daySeconds)).toBe(37);
  });

  it("advances by reading the clock, so a late tick loses nothing", () => {
    const w = bornAt(at("2026-08-04T20:00:00Z"));
    w.advanceToWallClock(at("2026-08-04T20:00:01Z"));
    expect(w.time).toBe(1);
    // the host stalls for four seconds — a counting world would be four behind
    w.advanceToWallClock(at("2026-08-04T20:00:05Z"));
    expect(w.time).toBe(5);
    // and a tick that fires early does nothing at all
    w.advanceToWallClock(at("2026-08-04T20:00:05Z"));
    expect(w.time).toBe(5);
  });

  it("comes back from a restart at the true hour, however long it was down", () => {
    const w = bornAt(at("2026-08-04T20:00:00Z"));
    for (let s = 1; s <= 30; s++) w.advanceToWallClock(at("2026-08-04T20:00:00Z") + s * 1000);
    expect(w.time).toBe(30);

    // the snapshot is taken here, then the machine dies and is redeployed
    const restored = World.deserialize(w.serialize());
    expect(restored.anchor).toBe(w.anchor);
    restored.advanceToWallClock(at("2026-08-04T20:04:00Z"));
    // 240 s of wall clock passed; the world is at 240, not at 30
    expect(restored.time).toBe(240);
    expect(secondsIntoDay(restored.time, LAW.daySeconds)).toBe(40);
  });

  it("steps over a long sleep instead of simulating hours of it", () => {
    const w = bornAt(at("2026-08-04T20:00:00Z"));
    w.advanceToWallClock(at("2026-08-04T20:00:10Z"));
    const started = Date.now();
    w.advanceToWallClock(at("2026-08-04T23:00:10Z")); // three hours dark
    expect(w.time).toBe(3 * 3600 + 10);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("turns the day exactly once across a jump, never stepping over dawn", () => {
    const w = bornAt(at("2026-08-04T20:00:00Z"), { ...LAW, daylightShare: 1 });
    const r = w.join({ civ: "mongol" });
    w.debugGrant(r.islandId, { stocks: { food: 50 }, clearFoodSources: true });
    const island = w.island(r.islandId)!;
    // a full day passes while the process is down: the town eats once
    w.advanceToWallClock(at("2026-08-04T20:00:00Z") + 250_000);
    const afterJump = island.stocks.food ?? 0;
    expect(afterJump).toBeLessThan(50);
    w.advanceToWallClock(at("2026-08-04T20:00:00Z") + 250_050);
    expect(island.stocks.food).toBe(afterJump); // and only once
  });

  it("puts every island under the same sky, at the hour it really is", () => {
    const w = bornAt(at("2026-08-04T20:00:49Z"));
    w.join({ civ: "roman" });
    w.join({ civ: "norse" });
    w.advanceToWallClock(at("2026-08-04T20:00:50Z"));
    expect(new Set(w.islands().map((i) => i.dayClock)).size).toBe(1);
    expect(w.islands()[0]!.dayClock).toBe(50);
    expect(isNight(w.time, LAW.daySeconds, LAW.daylightShare)).toBe(true);
  });

  it("adopts a clock for a world saved before there was one, without a jump", () => {
    const legacy = World.create({ seed: 7, balance: LAW });
    legacy.tick(42);
    const restored = World.deserialize(legacy.serialize());
    expect(restored.anchor).toBeUndefined();
    const now = at("2026-08-04T20:00:00Z");
    restored.anchorTo(now - restored.time * 1000);
    restored.advanceToWallClock(now);
    expect(restored.time).toBe(42); // exactly where it was — nothing lost, nothing invented
    restored.advanceToWallClock(now + 8000);
    expect(restored.time).toBe(50);
  });
});
