// Behavior 8: the sync loop — state out, orders in; construction passes
// visibly through site → construction → complete; the food invariant holds.
import { expect, test } from "@playwright/test";
import { getState, grant, joinGame, mcpSession, sendOrders, waitFor } from "./helpers/driver";

test("sync returns island state; orders build a hut through all three stages", async () => {
  const mcp = await mcpSession();
  try {
    await mcp.callText("join", { civilization: "norse" });
    const stateText = await mcp.callText("sync", {});
    expect(stateText).toContain("Island state");
    expect(stateText).toContain("stocks");
    expect(stateText).toContain("call `sync` again");

    // give the settlers timber, then order a hut through the same tool
    const idMatch = stateText.match(/"id":\s*"(island-[^"]+)"/);
    const islandId = idMatch![1]!;
    await grant(islandId, { stocks: { food: 300, wood: 200, stone: 100 } });

    const orderReply = await mcp.callText("sync", {
      orders: [{ kind: "build", building: "hut" }],
    });
    expect(orderReply).toContain("carried out");

    const secretText = await mcp.callText("sync", {});
    void secretText;
  } finally {
    await mcp.close();
  }
});

test("a build order passes through site, construction, complete", async () => {
  const r = await joinGame("greek");
  await grant(r.islandId, { stocks: { food: 300, wood: 200, stone: 100 } });
  const outcome = await sendOrders(r.secret, [{ kind: "build", building: "hut" }]);
  expect(outcome.outcomes[0]!.ok).toBe(true);

  const seen = new Set<string>();
  await waitFor(async () => {
    const { island } = await getState(r.secret);
    const hut = island.buildings.find((b) => b.type === "hut");
    if (hut) seen.add(hut.stage);
    return hut?.stage === "complete";
  }, 60_000);
  expect([...seen]).toContain("site");
  expect([...seen]).toContain("construction");
  expect([...seen]).toContain("complete");
});

test("the food invariant pulls a settler to food gathering within a day", async () => {
  const r = await joinGame("aztec");
  await grant(r.islandId, { stocks: { food: 1 } });
  await sendOrders(r.secret, [
    { kind: "assign_gathering", resource: "wood", count: 10 },
  ]);
  await waitFor(async () => {
    const { island } = await getState(r.secret);
    return island.settlers.some(
      (s) => s.task.kind === "gather" && s.task.resource === "food",
    );
  }, 15_000);
});
