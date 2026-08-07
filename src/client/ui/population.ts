import type { Island } from "../../shared/types";

export interface PopulationReading {
  count: number;
  label: "person" | "people";
  text: string;
}

/** The canonical population reading comes from the simulation's settlers. */
export function populationReading(island: Pick<Island, "settlers">): PopulationReading {
  const count = island.settlers.length;
  const label = count === 1 ? "person" : "people";
  return { count, label, text: `👥 ${count} ${label}` };
}

/** Keep the key-holder's population pill in sync with each live island frame. */
export function updatePopulation(island: Pick<Island, "settlers">): void {
  const el = document.getElementById("population");
  if (!el) return;
  const reading = populationReading(island);
  el.hidden = false;
  el.textContent = reading.text;
  el.title = `${reading.count} ${reading.label} live in your civilization`;
}
