import { describe, expect, it } from "vitest";
import { drawableModel } from "../shared/voxel";
import { CREATION_MODEL_EXAMPLE } from "../shared/rules";
import type { Order } from "../shared/types";
import { Hub, type HubSocket } from "./ws";
import { World } from "./world";

const FAST = { daySeconds: 10, daylightShare: 1 };

const create: Order = {
  kind: "create",
  creation: {
    name: "Moon Ninjas",
    description: "silent blades of the night",
    model: CREATION_MODEL_EXAMPLE,
    stats: { power: 7, speed: 5, resilience: 3 },
    verbs: ["raid", "patrol"],
    count: 2,
  },
};

function playerWithNinjas() {
  const w = World.create({ seed: 11, balance: FAST });
  const p = w.join({ civ: "japanese" });
  w.debugGrant(p.islandId, { stocks: { food: 5000, wood: 5000 } });
  const [out] = w.applyOrders(p.secret, [create]);
  expect(out!.ok).toBe(true);
  return { w, p };
}

/** A socket that just remembers what the hub said to it. */
function recorder(): HubSocket & { frames: Record<string, unknown>[] } {
  const frames: Record<string, unknown>[] = [];
  return {
    readyState: 1,
    frames,
    send(data: string) {
      frames.push(JSON.parse(data) as Record<string, unknown>);
    },
    on() {
      return this;
    },
    close() {},
  };
}

type WireSpec = { id: string; name: string; model?: unknown };
const specsIn = (frame: Record<string, unknown>): WireSpec[] =>
  (frame.islands as { creationSpecs?: WireSpec[] }[]).flatMap((i) => i.creationSpecs ?? []);

describe("every creation is stored as a solid", () => {
  it("keeps the design's 3D model on the spec", () => {
    const { w, p } = playerWithNinjas();
    const spec = w.island(p.islandId)!.creationSpecs![0]!;
    expect(drawableModel(spec.model)).not.toBeNull();
    expect(spec.sprite).toBeUndefined();
  });

  it("carves designs saved before the world went solid, once, on load", () => {
    const { w } = playerWithNinjas();
    const save = JSON.parse(w.serialize()) as {
      islands: {
        creationSpecs?: { model?: unknown; sprite?: unknown }[];
      }[];
    };
    // rewrite the save the way the old world wrote it: flat art, no model
    const island = save.islands.find((i) => i.creationSpecs?.length)!;
    const spec = island.creationSpecs![0]!;
    delete spec.model;
    spec.sprite = {
      size: 8,
      palette: ["#1a1a2e", "#e94560"],
      pixels: [
        "..00....", ".0110...", "..00....", ".0000...",
        "0.00.0..", "..00....", ".0..0...", "0....0..",
      ],
    };

    const loaded = World.deserialize(JSON.stringify(save));
    const carved = loaded
      .islands()
      .flatMap((i) => i.creationSpecs ?? [])
      .find((s) => s.name === "Moon Ninjas")!;
    expect(drawableModel(carved.model)).not.toBeNull();
    // the original art is kept as provenance, but it is never what renders
    expect(carved.sprite).toBeDefined();
  });
});

describe("models travel the wire once", () => {
  it("hands a new viewer every model, then only design ids", () => {
    const { w } = playerWithNinjas();
    const hub = new Hub(w, w.law, new Map<string, number>());
    const socket = recorder();
    hub.attachSocket(socket);

    const greeting = socket.frames.find((f) => f.type === "world")!;
    const first = specsIn(greeting);
    expect(first).toHaveLength(1);
    expect(drawableModel(first[0]!.model)).not.toBeNull();

    socket.frames.length = 0;
    hub.broadcastTick([]);
    const second = specsIn(socket.frames.find((f) => f.type === "world")!);
    expect(second).toHaveLength(1);
    expect(second[0]!.name).toBe("Moon Ninjas");
    expect(second[0]!.model).toBeUndefined();

    // a viewer who arrives later still learns the design in full
    const late = recorder();
    hub.attachSocket(late);
    expect(drawableModel(specsIn(late.frames[0]!)[0]!.model)).not.toBeNull();
  });

  it("keeps the whole design on a watched island — the readouts read its verbs", () => {
    const { w, p } = playerWithNinjas();
    const hub = new Hub(w, w.law, new Map<string, number>());
    const socket = recorder();
    hub.attachSocket(socket);
    socket.frames.length = 0;
    hub.attachSocket(socket); // second greeting is irrelevant; subscribe below
    (socket as unknown as { on: unknown }).on = () => socket;
    hub.broadcastTick([]);
    // subscribe the way a watching browser does, then read the island frame
    const client = socket;
    client.frames.length = 0;
    hub["clients"].forEach((c) => c.subscribed.add(p.islandId));
    hub.broadcastTick([]);
    const islandFrame = client.frames.find((f) => f.type === "island")!;
    const spec = (islandFrame.island as { creationSpecs: { verbs?: string[] }[] })
      .creationSpecs[0]!;
    expect(spec.verbs).toEqual(["raid", "patrol"]);
  });
});
