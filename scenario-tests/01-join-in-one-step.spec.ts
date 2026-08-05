// Behavior 1: join in one step from Claude Code — civ pick, island name in
// the civ's style, personal link; opening it lands on your island.
import { expect, test } from "@playwright/test";
import { mcpSession } from "./helpers/driver";

test("joining via the MCP tool founds a named island and hands back the personal link", async ({ page }) => {
  const mcp = await mcpSession();
  try {
    const text = await mcp.callText("join", { civilization: "roman" });
    expect(text).toContain("island rises from the sea");
    const nameMatch = text.match(/\*\*(.+?)\*\*/);
    expect(nameMatch).not.toBeNull();
    const islandName = nameMatch![1]!;

    const linkMatch = text.match(/http:\/\/[^\s]+\?key=[^\s]+/);
    expect(linkMatch, "reply must contain the personal ?key= link").not.toBeNull();
    const playerUrl = linkMatch![0]!;

    await page.goto(playerUrl);
    await expect(page.getByTestId("island-title")).toHaveText(islandName, {
      timeout: 15_000,
    });
    await expect(page.locator("#world")).toBeVisible();
  } finally {
    await mcp.close();
  }
});
