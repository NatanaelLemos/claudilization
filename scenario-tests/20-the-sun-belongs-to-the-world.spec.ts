// Behavior 20: the world has one sun. Peeking at another player's island must
// not move the hour — the day used to flip to night the moment you looked
// across the map, and stayed there, because the sky was seeded from whatever
// clock that island happened to be carrying.
import { expect, test } from "@playwright/test";
import { joinGame, pulse } from "./helpers/driver";
import { BASE } from "./helpers/driver";

declare global {
  interface Window {
    __dayFrac?: () => number;
    __focused?: () => { id?: string; title: string | null };
    __lookAt?: (x: number, z: number) => void;
    __worldTime?: () => number | undefined;
  }
}

const worldNow = async () =>
  (await (await fetch(`${BASE}/api/world`)).json()) as {
    time: number;
    islands: { id: string; position: { x: number; y: number } }[];
  };

test("peeking at another island never moves the hour", async ({ page }) => {
  const a = await joinGame("greek");
  const b = await joinGame("mongol");
  await pulse(a.secret, 4000);
  await pulse(b.secret, 4000);

  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__focused?.().id), null, {
    timeout: 20_000,
  });

  const phaseHere = async () => {
    const world = await worldNow();
    const day = 6; // the scenario clock (see playwright.config.ts)
    const client = await page.evaluate(() => window.__dayFrac?.() ?? -1);
    return { world: (world.time % day) / day, client, islands: world.islands };
  };

  const before = await phaseHere();
  const here = await page.evaluate(() => window.__focused?.().id);
  const there = before.islands.find((i) => i.id !== here) ?? before.islands[0]!;

  // fly across the map to the neighbour and let the focus settle on it
  await page.evaluate(
    ([x, z]) => window.__lookAt?.(x as number, z as number),
    [there.position.x, there.position.y],
  );
  await page.waitForFunction((id) => window.__focused?.().id === id, there.id, {
    timeout: 20_000,
  });

  // the sky still reads the world's clock, not the island's
  const after = await phaseHere();
  const drift = Math.abs(after.client - after.world);
  expect(Math.min(drift, 1 - drift)).toBeLessThan(0.2);

  // and it keeps turning while we sit on the neighbour — never frozen
  const seen = new Set<string>();
  for (let i = 0; i < 8; i++) {
    seen.add((await page.evaluate(() => window.__dayFrac?.() ?? -1)).toFixed(1));
    await page.waitForTimeout(400);
  }
  expect(seen.size).toBeGreaterThan(1);
});
