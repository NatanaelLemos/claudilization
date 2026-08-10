// Visual contract: the authored clay world reaches the real browser, keeps the
// HUD readable on phones, and exposes the reduced-motion branch used by world
// ambience and catastrophe presentation.
import { expect, test } from "@playwright/test";
import { joinGame } from "./helpers/driver";

test("the live canvas carries the miniature-clay art marker and responsive HUD", async ({ page }) => {
  const player = await joinGame("mauryan");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?key=${player.secret}`);
  await expect(page.locator("canvas#world")).toHaveAttribute(
    "data-art-direction",
    "miniature-clay-v1",
  );
  await expect(page.locator("canvas#world")).toHaveAttribute(
    "data-water",
    "clay-water-waves-v1",
  );
  await expect(page.getByTestId("compass")).toBeVisible();
  await expect(page.getByTestId("island-title")).not.toBeEmpty({ timeout: 15_000 });
  const titleBox = await page.getByTestId("island-title").boundingBox();
  expect(titleBox?.x).toBeGreaterThanOrEqual(0);
  expect((titleBox?.x ?? 0) + (titleBox?.width ?? 0)).toBeLessThanOrEqual(390);
  const timerBox = await page.getByTestId("catastrophe-status").boundingBox();
  const hudBox = await page.locator("#hud").boundingBox();
  expect((timerBox?.y ?? 0) + (timerBox?.height ?? 0)).toBeLessThanOrEqual(hudBox?.y ?? 0);
});

test("reduced motion is detected before ambient effects run", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await page.goto("http://localhost:8790/");
    await expect(page.locator("canvas#world")).toHaveAttribute(
      "data-art-direction",
      "miniature-clay-v1",
    );
    await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
    await expect(page.locator("canvas#world")).toHaveAttribute(
      "data-water",
      "clay-water-waves-v1",
    );
  } finally {
    await context.close();
  }
});
