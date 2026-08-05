import { describe, expect, it } from "vitest";
import { buildingSpec } from "../shared/buildings";
import { World } from "./world";

const FAST = { daySeconds: 10, daylightShare: 1 };

describe("bronze-age food production", () => {
  it("farms and livestock pens are bronze buildings that yield food daily", () => {
    for (const type of ["farm", "livestock-pen"]) {
      const spec = buildingSpec(type)!;
      expect(spec.age).toBe("bronze");
      expect(spec.foodPerDay).toBeGreaterThan(0);
    }
  });

  it("a stone-age island cannot start a farm or a livestock pen", () => {
    const w = World.create({ seed: 9, balance: FAST });
    const r = w.join({ civ: "aztec" });
    w.debugGrant(r.islandId, { stocks: { food: 500, wood: 500, stone: 500 } });
    for (const building of ["farm", "livestock-pen"]) {
      const [outcome] = w.applyOrders(r.secret, [{ kind: "build", building }]);
      expect(outcome!.ok).toBe(false);
      expect(outcome!.reason).toContain("bronze");
    }
  });

  it("completed farms and pens add their yield to the stores each day", () => {
    const w = World.create({ seed: 9, balance: FAST });
    const r = w.join({ civ: "roman" });
    w.debugGrant(r.islandId, {
      age: "bronze",
      stocks: { food: 100 },
      clearFoodSources: true, // no wild gathering can muddy the ledger
      addBuilding: { type: "farm", stage: "complete" },
    });
    w.debugGrant(r.islandId, {
      addBuilding: { type: "livestock-pen", stage: "complete" },
    });

    const island = () => w.island(r.islandId)!;
    const settlers = island().settlers.length;
    const yieldPerDay =
      buildingSpec("farm")!.foodPerDay! + buildingSpec("livestock-pen")!.foodPerDay!;

    w.tick(FAST.daySeconds);
    expect(island().stocks.food).toBe(100 + yieldPerDay - settlers);
  });

  it("an unfinished farm yields nothing", () => {
    const w = World.create({ seed: 9, balance: FAST });
    const r = w.join({ civ: "roman" });
    w.debugGrant(r.islandId, {
      age: "bronze",
      stocks: { food: 100 },
      clearFoodSources: true,
      addBuilding: { type: "farm", stage: "site" },
    });
    // nobody may build, or the site would finish mid-test
    for (const s of w.island(r.islandId)!.settlers) s.task = { kind: "sail", boatId: "x" };

    w.tick(FAST.daySeconds);
    expect(w.island(r.islandId)!.stocks.food).toBe(
      100 - w.island(r.islandId)!.settlers.length,
    );
  });

  it("the day's harvest feeds the day's meals — grown food reaches the table same-day", () => {
    const w = World.create({ seed: 9, balance: FAST });
    const r = w.join({ civ: "roman" });
    w.debugGrant(r.islandId, {
      age: "bronze",
      stocks: { food: 0 },
      clearFoodSources: true,
      addBuilding: { type: "farm", stage: "complete" },
    });

    w.tick(FAST.daySeconds);
    const fed = w
      .island(r.islandId)!
      .settlers.filter((s) => s.hungerDays === 0).length;
    expect(fed).toBe(buildingSpec("farm")!.foodPerDay!);
  });
});
