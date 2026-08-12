// Visual evidence for one *named* island: the gauntlet needs to see the same
// change at both ends of history, and the opening camera only ever picks one
// island. Flies the live world's camera to the island you ask for, waits for
// the corner title to agree that it is being watched, then saves the frame.
//
// Same hard-won capture rules as capture-evidence.mjs: bounded waits (a 45
// island world never drains `pending === 0` under SwiftShader) and raw CDP
// screenshots (Playwright blocks on document.fonts.ready first).
//
//   node scripts/capture-island.mjs <url> <islandId> <outPrefix> [dayFraction]
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const [, , url, islandId, outPrefix, dayFraction] = process.argv;
if (!url || !islandId || !outPrefix) {
  console.error(
    "usage: node scripts/capture-island.mjs <url> <islandId> <outPrefix> [dayFraction]",
  );
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForFunction(() => (window.__terrain?.()?.built ?? 0) >= 3, undefined, {
  timeout: 120_000,
});

const target = await page.evaluate(async (id) => {
  const world = await fetch("/api/world").then((r) => r.json());
  return world.islands.find((i) => i.id === id);
}, islandId);
if (!target) {
  console.error(`no island ${islandId} in this world`);
  await browser.close();
  process.exit(1);
}

// fly there, then let the camera come to rest: the world only changes who it
// is watching after the same island wins two half-second looks in a row
let watched = false;
for (let attempt = 0; attempt < 12 && !watched; attempt++) {
  await page.evaluate((p) => window.__lookAt?.(p.x, p.y), target.position);
  await page.waitForTimeout(2_500);
  watched = await page.evaluate((id) => window.__focused?.()?.id === id, islandId);
}
if (!watched) console.error(`warning: ${islandId} never became the watched island`);

await page
  .waitForFunction(() => window.__terrain?.()?.pending === 0, undefined, { timeout: 45_000 })
  .catch(() => {});
if (dayFraction) await page.evaluate((f) => window.__day?.(Number(f)), dayFraction);
await page.waitForTimeout(5_000); // settle streaming meshes, shadows, town life

const file = `${outPrefix}.png`;
const cdp = await page.context().newCDPSession(page);
const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
await writeFile(file, Buffer.from(data, "base64"));
const marker = await page.evaluate(() => ({
  focused: window.__focused?.(),
  art: document.querySelector("canvas#world")?.dataset.artDirection,
  post: document.querySelector("canvas#world")?.dataset.post,
  perf: window.__perf?.(),
}));
console.log(file, JSON.stringify({ age: target.age, name: target.name, ...marker }));
await browser.close();
