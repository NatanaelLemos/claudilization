// Visual evidence capture: opens the world in headless Chromium (SwiftShader
// WebGL), waits for terrain streaming to finish, and saves desktop + mobile
// screenshots. Pooled-browser WebGL is unavailable, so this local harness is
// the release-evidence path, exactly as in the clay-diorama pass.
//
//   node scripts/capture-evidence.mjs <url> <outPrefix> [dayFraction]
import { chromium } from "@playwright/test";

const [, , url, outPrefix, dayFraction] = process.argv;
if (!url || !outPrefix) {
  console.error("usage: node scripts/capture-evidence.mjs <url> <outPrefix> [dayFraction]");
  process.exit(1);
}

const browser = await chromium.launch();
const shots = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];
for (const shot of shots) {
  const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height } });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => {
      const t = window.__terrain?.();
      return t && t.built > 0 && t.pending === 0;
    },
    undefined,
    { timeout: 90_000 },
  );
  if (dayFraction) {
    await page.evaluate((f) => window.__day?.(Number(f)), dayFraction);
  }
  await page.waitForTimeout(4_000); // settle streaming meshes and shadows
  const file = `${outPrefix}-${shot.name}.png`;
  await page.screenshot({ path: file });
  const marker = await page.evaluate(() => ({
    art: document.querySelector("canvas#world")?.dataset.artDirection,
    beauty: document.querySelector("canvas#world")?.dataset.beauty,
    water: document.querySelector("canvas#world")?.dataset.water,
    post: document.querySelector("canvas#world")?.dataset.post,
    perf: window.__perf?.(),
  }));
  console.log(file, JSON.stringify(marker));
  await page.close();
}
await browser.close();
