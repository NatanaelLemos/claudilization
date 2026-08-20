import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const [, , url, out, dayFraction] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForFunction(() => (window.__terrain?.()?.built ?? 0) >= 1, undefined, {
  timeout: 120_000,
});
await page
  .waitForFunction(() => window.__terrain?.()?.pending === 0, undefined, { timeout: 45_000 })
  .catch(() => {});
if (dayFraction) await page.evaluate((f) => window.__day?.(Number(f)), Number(dayFraction));
await page.waitForTimeout(6_000);
const cdp = await page.context().newCDPSession(page);
const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
await writeFile(out, Buffer.from(data, "base64"));
console.log(out, JSON.stringify(await page.evaluate(() => ({
  terrain: window.__terrain?.(),
  water: document.querySelector("canvas#world")?.dataset.water,
}))));
await browser.close();
