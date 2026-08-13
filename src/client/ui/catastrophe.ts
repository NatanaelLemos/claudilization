import {
  catastropheDefinition,
  type CatastropheId,
  type CatastropheStatus,
} from "../../shared/catastrophes";

export interface CatastropheView {
  phase: "scheduled" | "warning" | "active";
  title: string;
  detail: string;
  id?: CatastropheId;
}

function duration(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}


/** Pure display model so reconnect/countdown behavior is testable without a DOM. */
export function catastropheView(
  status: CatastropheStatus,
  worldSeconds: number,
): CatastropheView {
  if (status.active) {
    const definition = catastropheDefinition(status.active.id);
    return {
      phase: "active",
      id: status.active.id,
      title: `${definition.icon} ${definition.label}`,
      detail: `Aftermath ${duration(status.active.endsAt - worldSeconds)} · ${
        status.active.impact.inhabitedIslands
      } civilizations hit · ${Math.round(status.active.impact.resourcesLost)} materials lost`,
    };
  }
  const remaining = Math.max(0, status.nextAt - worldSeconds);
  const warning = remaining <= status.warningSeconds;
  return {
    phase: warning ? "warning" : "scheduled",
    title: `Global catastrophe in ${duration(remaining)}`,
    detail: warning
      ? "Impact is imminent — every island and player will be affected"
      : "The world keeps no schedule — strikes fall an hour, five, or a day apart",
  };
}

export function updateCatastropheStatus(
  status: CatastropheStatus,
  worldSeconds: number,
): void {
  const host = document.getElementById("catastrophe-status");
  if (!host) return;
  const model = catastropheView(status, worldSeconds);
  host.className = `catastrophe-status ${model.phase}`;
  host.dataset.catastrophe = model.id ?? "pending";
  host.replaceChildren();

  const title = document.createElement("strong");
  title.textContent = model.title;
  const detail = document.createElement("span");
  detail.textContent = model.detail;
  host.append(title, detail);
  host.hidden = false;
}

let flashTimer: ReturnType<typeof setTimeout> | undefined;

/** Lightweight full-screen color pulse; it adds no three.js objects or draw calls. */
export function pulseCatastrophe(id: CatastropheId): void {
  document.body.dataset.catastropheActive = id;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    delete document.body.dataset.catastropheActive;
  }, 2200);
}
