import { describe, expect, it } from "vitest";
import { skyClock } from "./skyClock";

/** A hand-cranked monotonic clock, in milliseconds. */
function fakeNow() {
  let ms = 1000;
  return {
    now: () => ms,
    advance(seconds: number) {
      ms += seconds * 1000;
    },
  };
}

describe("the viewer's read of the world clock", () => {
  it("derives the phase from clock time, not from when the scene mounted", () => {
    const t = fakeNow();
    const sky = skyClock(t.now);
    sky.sync(900, 3600); // quarter past dawn
    expect(sky.phase()).toBeCloseTo(0.25);
    t.advance(900);
    expect(sky.phase()).toBeCloseTo(0.5);

    // a scene created 900 s later, told the same world time, reads the same
    // sky as one that has been running all along — mount time means nothing
    const fresh = skyClock(t.now);
    fresh.sync(sky.worldTime(), 3600);
    expect(fresh.phase()).toBeCloseTo(sky.phase());
  });

  it("keeps advancing between world frames instead of freezing", () => {
    const t = fakeNow();
    const sky = skyClock(t.now);
    sky.sync(0, 100);
    t.advance(30);
    expect(sky.phase()).toBeCloseTo(0.3);
    t.advance(40);
    expect(sky.phase()).toBeCloseTo(0.7);
  });

  it("never lets a late frame drag the sun backwards", () => {
    const t = fakeNow();
    const sky = skyClock(t.now);
    sky.sync(3000, 3600);
    const before = sky.phase();
    sky.sync(2400, 3600); // an out-of-order frame from six hundred seconds ago
    expect(sky.phase()).toBeCloseTo(before);
  });

  it("honours a genuine world reset — a new world starts a new day", () => {
    const t = fakeNow();
    const sky = skyClock(t.now);
    sky.sync(3600 * 20, 3600);
    sky.sync(5, 3600); // the world was wiped and reborn
    expect(sky.phase()).toBeCloseTo(5 / 3600);
  });

  it("takes the world's day length, so fast worlds keep a fast sun", () => {
    const t = fakeNow();
    const sky = skyClock(t.now);
    sky.sync(5, 10);
    expect(sky.phase()).toBeCloseTo(0.5);
  });

  it("pins for screenshots and releases back onto the world clock", () => {
    const t = fakeNow();
    const sky = skyClock(t.now);
    sky.sync(900, 3600);
    sky.pin(0.8);
    expect(sky.phase()).toBeCloseTo(0.8);
    t.advance(60);
    expect(sky.phase()).toBeCloseTo(0.8);
    sky.unpin();
    expect(sky.phase()).toBeCloseTo(960 / 3600);
  });
});
