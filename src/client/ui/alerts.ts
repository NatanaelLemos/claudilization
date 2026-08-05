import { shadeCivColor } from "../../shared/civColor";
import type { GameEvent } from "../../shared/types";

/** What an alert names on each side: the island, in its banner color. */
export interface AlertParty {
  name: string;
  color?: string;
}

export interface AttackAlertModel {
  /** one card per attacker→defender pair — repeats refresh, never stack */
  key: string;
  defenderId: string;
  defender: AlertParty;
  attacker: AlertParty;
}

/**
 * The alert's identity and display parts out of a raw `under-attack` event.
 * Names and colors come from the world summaries every viewer already holds,
 * so the card is right for spectators and players alike; when a summary has
 * not landed yet the card still reads, just unnamed.
 */
export function attackAlertModel(
  e: GameEvent,
  lookup: (id: string) => AlertParty | undefined,
): AttackAlertModel | null {
  if (e.type !== "under-attack" || !e.islandId) return null;
  const defender = lookup(e.islandId) ?? { name: "A distant colony" };
  const attacker =
    (e.attackerId ? lookup(e.attackerId) : undefined) ?? { name: "unknown raiders" };
  return {
    key: `${e.attackerId ?? "?"}>${e.islandId}`,
    defenderId: e.islandId,
    defender,
    attacker,
  };
}

/** How long a card stands before it fades on its own. */
const ALERT_MS = 20_000;

const live = new Map<string, { el: HTMLElement; timer: ReturnType<typeof setTimeout> }>();

function dismiss(key: string): void {
  const card = live.get(key);
  if (!card) return;
  live.delete(key);
  card.el.classList.add("fading");
  clearTimeout(card.timer);
  setTimeout(() => card.el.remove(), 600);
}

/** A name in its civilization's color, lifted for legibility on the panel. */
function nameSpan(party: AlertParty): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "attack-alert-name";
  span.textContent = party.name;
  if (party.color) span.style.color = shadeCivColor(party.color, 0.22);
  return span;
}

/**
 * The tocsin card, top-center for every viewer: "X is being attacked by Y",
 * with a button that flies the camera to the fight. The same wave rings once —
 * a repeat of the same attacker→defender pair only resets the fade clock.
 */
export function showAttackAlert(model: AttackAlertModel, onSee: () => void): void {
  const host = document.getElementById("alerts");
  if (!host) return;
  const prior = live.get(model.key);
  if (prior) {
    clearTimeout(prior.timer);
    prior.timer = setTimeout(() => dismiss(model.key), ALERT_MS);
    return;
  }
  const el = document.createElement("div");
  el.className = "attack-alert";
  el.setAttribute("data-testid", "attack-alert");
  el.setAttribute("role", "alert");

  const text = document.createElement("span");
  text.className = "attack-alert-text";
  text.append(nameSpan(model.defender), " is being attacked by ", nameSpan(model.attacker));

  const see = document.createElement("button");
  see.type = "button";
  see.className = "attack-alert-see";
  see.setAttribute("data-testid", "attack-alert-see");
  see.textContent = "See it →";
  see.addEventListener("click", () => {
    dismiss(model.key);
    onSee();
  });

  const close = document.createElement("button");
  close.type = "button";
  close.className = "attack-alert-close";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "×";
  close.addEventListener("click", () => dismiss(model.key));

  el.append(text, see, close);
  host.append(el);
  live.set(model.key, { el, timer: setTimeout(() => dismiss(model.key), ALERT_MS) });
}
