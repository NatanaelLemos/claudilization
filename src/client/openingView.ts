import type { Building } from "../shared/types";
import { ART_DIRECTION } from "./artDirection";
import type { IslandSummary } from "./net";

/** Pick land before moving the camera: owner first, otherwise the liveliest island. */
export function openingIslandId(
  summaries: readonly IslandSummary[],
  myIslandId?: string,
): string | undefined {
  if (myIslandId && summaries.some((summary) => summary.id === myIslandId)) return myIslandId;
  return [...summaries]
    .sort(
      (a, b) =>
        b.lastPulseSeq - a.lastPulseSeq ||
        b.population - a.population ||
        (a.id < b.id ? -1 : 1),
    )[0]?.id;
}


/** The framing the landing camera should use: where to aim, and how far to
 * stand back, expressed as a multiple of the authored landing distance. */
export interface TownFraming {
  /** island-local offset of the town's centre, in tiles */
  offsetX: number;
  offsetZ: number;
  /** multiplier on the authored landing height/distance */
  scale: number;
}

/** The town radius the authored landing distance was composed around. */
export const FRAMED_TOWN_RADIUS = 30;
/** How close and how far the landing may ever be pulled. The ceiling is 1:
 * the authored landing already holds a whole island, and letting a large city
 * push the camera *back* made the town own less of the frame, not more —
 * caught on the live frame the first time this shipped. Framing may only ever
 * close in on the town. */
export const FRAMING_SCALE_RANGE: readonly [number, number] = [0.6, 1];

/**
 * The town is the subject, not the island. A five-hut landing was being shot
 * from the same distance as a hundred-block metropolis, so the settlement sat
 * as a speck in a lawn — the single biggest composition gap against the
 * reference. Aim at where the buildings actually are and stand back in
 * proportion to how far they spread, clamped so a lone hut never becomes a
 * macro shot and a sprawling city never leaves the frame.
 */
export function townFraming(buildings: readonly Building[] | undefined, half: number): TownFraming {
  const built = (buildings ?? []).filter((b) => b.stage === "complete" || b.stage === "site");
  if (built.length < 2) return { offsetX: 0, offsetZ: 0, scale: 1 };
  let sumX = 0;
  let sumZ = 0;
  for (const b of built) {
    sumX += b.pos.x - half;
    sumZ += b.pos.y - half;
  }
  // never aim past the island's own shelf: a harbour strung along one coast
  // would otherwise drag the shot out over open water
  const reach = half * 0.45;
  const clamp = (v: number) => Math.min(reach, Math.max(-reach, v));
  const offsetX = clamp(sumX / built.length);
  const offsetZ = clamp(sumZ / built.length);
  // an 85th-percentile radius, so one remote lighthouse cannot dictate the
  // shot the way a bounding box would
  const distances = built
    .map((b) => Math.hypot(b.pos.x - half - offsetX, b.pos.y - half - offsetZ))
    .sort((a, b) => a - b);
  const radius = distances[Math.min(distances.length - 1, Math.floor(distances.length * 0.85))]!;
  const [min, max] = FRAMING_SCALE_RANGE;
  // +12 tiles of air so the town never touches the frame edge
  const scale = Math.min(max, Math.max(min, (radius + 12) / (FRAMED_TOWN_RADIUS + 12)));
  return { offsetX, offsetZ, scale };
}

/**
 * Where the landing camera stands and what it looks at. The authored landing
 * is composed for a town of `FRAMED_TOWN_RADIUS`; a smaller settlement pulls
 * the shot in and a sprawling one lets it out, and the aim point follows the
 * buildings rather than the middle of the island — the town is the subject.
 * The approach direction and pitch never change: due south, facing north.
 */
export function landingShot(
  x: number,
  z: number,
  mobile: boolean,
  framing?: TownFraming,
): [number, number, number, number, number] {
  const scale = framing?.scale ?? 1;
  const aimX = x + (framing?.offsetX ?? 0);
  const aimZ = z + (framing?.offsetZ ?? 0);
  const y = (ART_DIRECTION.camera.landing.y + (mobile ? 12 : 0)) * scale;
  const back = (ART_DIRECTION.camera.landing.z + (mobile ? 18 : 0)) * scale;
  return [aimX, y, aimZ + back, aimX, aimZ];
}
