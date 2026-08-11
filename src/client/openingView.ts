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

