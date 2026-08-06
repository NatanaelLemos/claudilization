import { describe, expect, it } from "vitest";
import {
  AdaptiveRenderQuality,
  renderQualityProfile,
  ShadowRefreshBudget,
} from "./renderQuality";

describe("adaptive render quality", () => {
  it("caps expensive buffers while preserving native DPR on ordinary screens", () => {
    expect(renderQualityProfile("high", 3)).toEqual({ pixelRatio: 2, shadowMapSize: 2048 });
    expect(renderQualityProfile("balanced", 2)).toEqual({ pixelRatio: 1.5, shadowMapSize: 1024 });
    expect(renderQualityProfile("performance", 2)).toEqual({ pixelRatio: 1, shadowMapSize: 512 });
    expect(renderQualityProfile("balanced", 1)).toEqual({ pixelRatio: 1, shadowMapSize: 1024 });
  });

  it("steps down on sustained slow frames and recovers only after stability", () => {
    const controller = new AdaptiveRenderQuality();
    for (let i = 0; i < 7; i++) expect(controller.sample(30)).toBeUndefined();
    expect(controller.sample(30)).toBe("balanced");
    for (let i = 0; i < 7; i++) expect(controller.sample(30)).toBeUndefined();
    expect(controller.sample(30)).toBe("performance");

    for (let i = 0; i < 599; i++) expect(controller.sample(16.7)).toBeUndefined();
    expect(controller.sample(16.7)).toBe("balanced");
    for (let i = 0; i < 599; i++) controller.sample(16.7);
    expect(controller.sample(16.7)).toBe("high");
  });

  it("does not react to a lone spike or a suspended-tab delta", () => {
    const controller = new AdaptiveRenderQuality();
    controller.sample(80);
    controller.sample(16);
    controller.sample(10_000);
    expect(controller.current()).toBe("high");
  });
});

describe("shadow refresh budget", () => {
  it("updates at 4 Hz while moving and 1 Hz while stationary", () => {
    const budget = new ShadowRefreshBudget();
    expect(budget.shouldRefresh(0, true)).toBe(true);
    expect(budget.shouldRefresh(249, true)).toBe(false);
    expect(budget.shouldRefresh(250, true)).toBe(true);
    expect(budget.shouldRefresh(1_249, false)).toBe(false);
    expect(budget.shouldRefresh(1_250, false)).toBe(true);
  });

  it("can be invalidated for a quality or scene change", () => {
    const budget = new ShadowRefreshBudget();
    expect(budget.shouldRefresh(10, false)).toBe(true);
    budget.invalidate();
    expect(budget.shouldRefresh(11, false)).toBe(true);
  });
});
