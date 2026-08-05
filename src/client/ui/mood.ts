import { DEFAULT_BALANCE } from "../../shared/balance";
import { computeHappiness } from "../../shared/happiness";
import type { Island } from "../../shared/types";

function face(score: number): string {
  if (score >= 75) return "😊";
  if (score >= 50) return "🙂";
  if (score >= 25) return "😐";
  return "😞";
}

/** The people's mood, pinned under the stocks — hover for what they want. */
export function updateMood(island: Island): void {
  const el = document.getElementById("mood");
  if (!el) return;
  const mood = computeHappiness(island, DEFAULT_BALANCE);
  el.hidden = false;
  el.textContent = `${face(mood.score)} ${mood.score} happiness`;
  const unmet = mood.needs.filter((n) => !n.met);
  el.title = unmet.length
    ? `The people still want: ${unmet.map((n) => n.label).join(" · ")}`
    : "The people are content — every need of the age is met";
}
