import { describe, expect, it } from "vitest";
import type { Island } from "../shared/types";
import { Net } from "./net";
import { skyClock } from "./skyClock";

/**
 * The bug this file exists to prevent: peeking at another player's island used
 * to re-seed the sky from *that island's* private clock, so the world turned to
 * night the moment you looked across the map — and stayed there, because every
 * pulse wrote the same frozen hour back.
 *
 * The rule now: only world frames carry the hour, and island detail can never
 * move it.
 */

const DAY = 3600;

function fakeNow() {
  let ms = 1000;
  return {
    now: () => ms,
    advance(seconds: number) {
      ms += seconds * 1000;
    },
  };
}

/** The wiring `main.ts` does: a sky clock fed by world frames alone. */
function viewer(now: () => number) {
  const net = new Net();
  const sky = skyClock(now);
  net.onWorldClock = (worldSeconds, daySeconds) => sky.sync(worldSeconds, daySeconds);
  const deliver = (frame: Record<string, unknown>) =>
    (net as unknown as { handle(f: Record<string, unknown>): void }).handle(frame);
  return { net, sky, deliver };
}

function worldFrame(time: number, islands: { id: string; dayClock: number }[] = []) {
  return {
    type: "world",
    time,
    daySeconds: DAY,
    islands: islands.map((i) => ({ id: i.id, time })),
  };
}

/** An island frame as the hub sends it — detail only, and a clock nobody reads. */
function islandFrame(id: string, dayClock: number) {
  return {
    type: "island",
    island: { id, dayClock, buildings: [], settlers: [], boats: [] } as unknown as Island,
  };
}

describe("the sky follows the world, never the island you are watching", () => {
  it("takes its hour from world frames only", () => {
    const t = fakeNow();
    const { sky, deliver } = viewer(t.now);
    deliver(worldFrame(900));
    expect(sky.phase()).toBeCloseTo(0.25);
    expect(sky.synced).toBe(true);
  });

  it("ignores the clock riding on island detail — even a deep-night one", () => {
    const t = fakeNow();
    const { sky, deliver } = viewer(t.now);
    deliver(worldFrame(900)); // the world is mid-morning
    const before = sky.phase();
    // a neighbour's island, its old private counter deep in its own night
    for (let i = 0; i < 30; i++) deliver(islandFrame("island-1", 2891 + i));
    expect(sky.phase()).toBeCloseTo(before);
    expect(sky.phase()).toBeLessThan(0.55); // still daylight, still not night
  });

  it("peeking at another island leaves the hour exactly where it would be", () => {
    const t = fakeNow();
    // one viewer stays home; the other wanders the map, subscribing to a
    // neighbour whose old counter sat in the dark
    const home = viewer(t.now);
    const wanderer = viewer(t.now);

    for (const v of [home, wanderer]) v.deliver(worldFrame(900, [{ id: "island-5", dayClock: 900 }]));

    for (let s = 1; s <= 20; s++) {
      t.advance(1);
      const time = 900 + s;
      home.deliver(worldFrame(time, [{ id: "island-5", dayClock: time }]));
      home.deliver(islandFrame("island-5", time));

      wanderer.deliver(worldFrame(time, [{ id: "island-5", dayClock: time }]));
      // the wanderer switched focus: the neighbour's detail arrives instead
      wanderer.deliver(islandFrame("island-1", 2891 + s));
    }

    expect(wanderer.sky.phase()).toBeCloseTo(home.sky.phase(), 6);
    expect(wanderer.net.worldTime).toBe(home.net.worldTime);
  });

  it("keeps turning while you look away — the hour is never paused", () => {
    const t = fakeNow();
    const { sky, deliver } = viewer(t.now);
    deliver(worldFrame(900));
    // the viewer wanders for a while and only island detail arrives
    for (let i = 0; i < 10; i++) {
      t.advance(60);
      deliver(islandFrame("island-1", 3000));
    }
    expect(sky.phase()).toBeCloseTo((900 + 600) / DAY);
  });

  it("falls back to the summary stamp when an older server omits world time", () => {
    const t = fakeNow();
    const { sky, net, deliver } = viewer(t.now);
    deliver({
      type: "world",
      daySeconds: DAY,
      islands: [{ id: "island-1", time: 1800 }],
    });
    expect(net.worldTime).toBe(1800);
    expect(sky.phase()).toBeCloseTo(0.5);
  });
});
