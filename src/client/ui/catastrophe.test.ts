import { describe, expect, it } from "vitest";
import type { CatastropheStatus } from "../../shared/catastrophes";
import { Net } from "../net";
import { catastropheView } from "./catastrophe";

const scheduled = (nextAt: number): CatastropheStatus => ({
  nextAt,
  intervalSeconds: 3600,
  warningSeconds: 300,
});

describe("the global catastrophe clock", () => {
  it("shows the canonical countdown without guessing from a client timer", () => {
    expect(catastropheView(scheduled(4600), 1000)).toEqual({
      phase: "scheduled",
      title: "Global catastrophe in 60:00",
      detail: "The world keeps no schedule — strikes fall an hour, five, or a day apart",
    });
  });

  it("switches to an explicit all-player warning in the final five minutes", () => {
    const view = catastropheView(scheduled(1300), 1001);
    expect(view.phase).toBe("warning");
    expect(view.title).toBe("Global catastrophe in 4:59");
    expect(view.detail).toContain("every island and player");
  });

  it("renders a late-joiner's active event and its canonical impact", () => {
    const status: CatastropheStatus = {
      ...scheduled(2800),
      active: {
        id: "godzilla",
        sequence: 4,
        scheduledAt: 1000,
        startedAt: 1002,
        endsAt: 1047,
        impact: {
          inhabitedIslands: 8,
          mapIslands: 12,
          resourcesLost: 4321.4,
          workPointsLost: 900,
          reservesLost: 0,
          buildingsDamaged: 14,
          boatsDestroyed: 0,
          creationsLost: 3,
        },
      },
    };
    const view = catastropheView(status, 1017);
    expect(view).toMatchObject({
      phase: "active",
      id: "godzilla",
      title: "◆ Godzilla attack",
    });
    expect(view.detail).toContain("Aftermath 0:30");
    expect(view.detail).toContain("8 civilizations hit");
    expect(view.detail).toContain("4321 materials lost");
  });

  it("takes schedule and active state directly from reconnect world frames", () => {
    const net = new Net();
    const status = scheduled(2800);
    let received: { status: CatastropheStatus; time: number } | undefined;
    net.onCatastrophe = (next, time) => (received = { status: next, time });
    (
      net as unknown as {
        handle(frame: Record<string, unknown>): void;
      }
    ).handle({ type: "world", time: 1234, catastrophe: status, islands: [] });
    expect(received).toEqual({ status, time: 1234 });
    expect(net.catastrophe).toEqual(status);
  });
});
