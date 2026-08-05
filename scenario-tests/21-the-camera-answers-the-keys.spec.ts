// Behavior 21: the camera answers the arrow keys — hold one and the view
// glides across the sea; typing in chat never moves it. And the ocean's
// terrain streams in on demand: every island's land is built shortly after
// load, the watched island first, without freezing the first paint.
import { expect, test } from "@playwright/test";
import { mcpSession } from "./helpers/driver";

type Vec3 = [number, number, number];

async function target(page: import("@playwright/test").Page): Promise<Vec3> {
  return (await page.evaluate("window.__target()")) as Vec3;
}

async function settled(page: import("@playwright/test").Page): Promise<Vec3> {
  // wait for any fly-to easing to finish so key motion is measured alone
  let last = await target(page);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const now = await target(page);
    const moved = Math.hypot(now[0] - last[0], now[2] - last[2]);
    last = now;
    if (moved < 0.05) return last;
  }
  return last;
}

test("arrow keys pan the camera; chat keeps its keystrokes; terrain builds on demand", async ({
  page,
}) => {
  const mcp = await mcpSession();
  try {
    const text = await mcp.callText("join", { civilization: "mongol" });
    const playerUrl = text.match(/http:\/\/[^\s]+\?key=[^\s]+/)![0]!;
    await page.goto(playerUrl);
    await expect(page.getByTestId("island-title")).not.toBeEmpty({ timeout: 15_000 });

    // on-demand terrain: the whole ocean's land finishes building shortly
    // after load instead of blocking the first frame
    await expect
      .poll(async () => (await page.evaluate("window.__terrain()")) as { pending: number },
        { timeout: 15_000 })
      .toMatchObject({ pending: 0 });
    const gauge = (await page.evaluate("window.__terrain()")) as { built: number };
    expect(gauge.built).toBeGreaterThan(0);

    // holding an arrow key glides the camera across the sea
    const before = await settled(page);
    await page.locator("canvas#world").click({ position: { x: 40, y: 400 } });
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(700);
    await page.keyboard.up("ArrowLeft");
    const after = await target(page);
    const panned = Math.hypot(after[0] - before[0], after[2] - before[2]);
    expect(panned).toBeGreaterThan(1);

    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(700);
    await page.keyboard.up("ArrowUp");
    const ahead = await target(page);
    expect(
      Math.hypot(ahead[0] - after[0], ahead[2] - after[2]),
    ).toBeGreaterThan(1);

    // typing in chat must never move the camera — the keystrokes are words
    const inChatBefore = await settled(page);
    const chat = page.getByTestId("chat-input");
    await chat.click();
    await chat.press("ArrowLeft");
    await chat.press("ArrowLeft");
    await page.waitForTimeout(400);
    const inChatAfter = await target(page);
    expect(
      Math.hypot(inChatAfter[0] - inChatBefore[0], inChatAfter[2] - inChatBefore[2]),
    ).toBeLessThan(0.5);
  } finally {
    await mcp.close();
  }
});
