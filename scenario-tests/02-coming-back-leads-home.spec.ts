// Behavior 2: joining twice returns the same island, never a second one;
// the secret is the identity, on disk and in the link.
import { expect, test } from "@playwright/test";
import { joinGame, mcpSession, worldSummary } from "./helpers/driver";

test("rejoining returns home instead of founding a second island", async () => {
  const mcp = await mcpSession();
  try {
    const first = await mcp.callText("join", { civilization: "greek" });
    const name = first.match(/\*\*(.+?)\*\*/)![1]!;
    const before = (await worldSummary()).islands.length;

    const again = await mcp.callText("join", { civilization: "greek" });
    expect(again).toContain("Welcome back");
    expect(again).toMatch(/\?key=/); // the personal link comes back too
    expect(again).toContain(name);
    expect((await worldSummary()).islands.length).toBe(before);
  } finally {
    await mcp.close();
  }
});

test("the raw secret is idempotent at the API too", async () => {
  const a = await joinGame("norse");
  const b = await joinGame("norse", a.secret);
  expect(b.islandId).toBe(a.islandId);
  expect(b.isNew).toBe(false);
});
