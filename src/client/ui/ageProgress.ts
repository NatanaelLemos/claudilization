/**
 * The road to the next age, pinned under the key-holder's larder: which age
 * comes next, and how much of the required work the island has already put
 * in. Work flows from completed prompts, so this is really a reading of how
 * much more prompting the empire needs.
 */
import { advanceRequirements, nextAge } from "../../shared/ages";
import { DEFAULT_BALANCE } from "../../shared/balance";
import type { Island } from "../../shared/types";

export interface AgeProgress {
  next: string;
  have: number;
  need: number;
  /** 0..1, clamped — the bar never overflows while the order is pending */
  share: number;
}

export function ageProgress(island: Pick<Island, "age" | "workPoints">): AgeProgress | null {
  const next = nextAge(island.age);
  if (!next) return null; // the future age is the horizon
  const need = Math.ceil(advanceRequirements(next, DEFAULT_BALANCE));
  const have = Math.floor(island.workPoints);
  return { next, have, need, share: Math.min(1, need > 0 ? have / need : 1) };
}

/** Render into #age-progress; hides itself at the final age. */
export function updateAgeProgress(island: Island): void {
  const box = document.getElementById("age-progress");
  if (!box) return;
  const p = ageProgress(island);
  box.hidden = !p;
  if (!p) return;
  const fmt = (n: number) => n.toLocaleString("en-US");
  box.replaceChildren();
  const title = document.createElement("div");
  title.className = "age-next";
  title.textContent = `Next: the ${p.next} age`;
  const track = document.createElement("div");
  track.className = "age-track";
  const fill = document.createElement("div");
  fill.className = "age-fill";
  fill.style.width = `${Math.round(p.share * 100)}%`;
  track.append(fill);
  const reading = document.createElement("div");
  reading.className = "age-reading";
  reading.textContent =
    p.have >= p.need
      ? `${fmt(p.have)} / ${fmt(p.need)} work — ready to advance`
      : `${fmt(p.have)} / ${fmt(p.need)} work — earned by completing prompts`;
  box.append(title, track, reading);
}
