// Visual evidence capture: opens the world in headless Chromium (SwiftShader
// WebGL), waits for terrain streaming to finish, and saves desktop + mobile
// screenshots. Pooled-browser WebGL is unavailable, so this local harness is
// the release-evidence path, exactly as in the clay-diorama pass.
//
//   node scripts/capture-evidence.mjs <url> <outPrefix> [dayFraction]
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";

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
  // The focused island and its neighbours must be built before the shot is
  // worth anything. A full drain is not a useful gate any more: the live world
  // is 45 islands and the distant ones stream in as lightweight silhouettes,
  // which software WebGL never finishes inside a capture window. Wait for the
  // foreground, then give the queue a bounded grace period to go quiet.
  await page.waitForFunction(() => (window.__terrain?.()?.built ?? 0) >= 3, undefined, {
    timeout: 120_000,
  });
  await page
    .waitForFunction(() => window.__terrain?.()?.pending === 0, undefined, { timeout: 45_000 })
    .catch(() => {});
  if (dayFraction) {
    await page.evaluate((f) => window.__day?.(Number(f)), dayFraction);
  }
  await page.waitForTimeout(4_000); // settle streaming meshes and shadows
  const file = `${outPrefix}-${shot.name}.png`;
  // Raw CDP rather than page.screenshot(): Playwright blocks on
  // document.fonts.ready first, and a webfont request that never settles in
  // this headless environment would strand the capture on a frame we can see
  // is already correct.
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  await writeFile(file, Buffer.from(data, "base64"));
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
