import type { GameEvent } from "../../shared/types";

const list = document.getElementById("feed-list")!;
const MAX_VISIBLE = 6;
const TOAST_MS = 10_000;

/**
 * Not a log: island events surface as fleeting toasts and fade. The world
 * itself — settlers walking, sites rising — is the record; world moments
 * get the banner, and history lives in the recap.
 */
export function addFeedEvents(events: GameEvent[]): void {
  for (const e of events) {
    const li = document.createElement("li");
    li.textContent = e.text;
    li.dataset.eventType = e.type;
    if (e.world) li.classList.add("world-moment");
    list.prepend(li);
    setTimeout(() => {
      li.classList.add("fading");
      setTimeout(() => li.remove(), 600);
    }, TOAST_MS);
  }
  while (list.children.length > MAX_VISIBLE) list.lastElementChild?.remove();
}
