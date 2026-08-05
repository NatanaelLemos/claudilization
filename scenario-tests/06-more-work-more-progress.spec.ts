// Behavior 6: activity scales with tokens; hammering diminishes but never
// hits zero — every pulse stays at or above the one-event floor.
import { expect, test } from "@playwright/test";
import { joinGame, pulse } from "./helpers/driver";

test("bigger work causes more activity; junk never drops below the floor", async () => {
  const r = await joinGame("roman");

  const tiny = await pulse(r.secret, 10);
  const huge = await pulse(r.secret, 500_000);
  expect(huge.events).toBeGreaterThanOrEqual(tiny.events);
  expect(huge.events).toBeGreaterThan(1);

  // hammer it — diminishing returns, but the floor never breaks
  for (let i = 0; i < 10; i++) {
    const hit = await pulse(r.secret, 1_000_000);
    expect(hit.events).toBeGreaterThanOrEqual(1);
  }
});
