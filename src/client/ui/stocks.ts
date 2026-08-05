import { AGE_RESOURCES } from "../../shared/ages";
import type { Island, ResourceId } from "../../shared/types";

/** Display order and dressing per resource — declared in age-progression order. */
export const RESOURCE_META: Record<ResourceId, { icon: string; label: string }> = {
  food: { icon: "🍖", label: "food" },
  wood: { icon: "🪵", label: "wood" },
  stone: { icon: "🪨", label: "stone" },
  copper: { icon: "🔶", label: "copper" },
  tin: { icon: "🔩", label: "tin" },
  iron: { icon: "⚙️", label: "iron" },
  steel: { icon: "🛠️", label: "steel" },
  marble: { icon: "🏛️", label: "marble" },
  gold: { icon: "🪙", label: "gold" },
  silver: { icon: "🥈", label: "silver" },
  preciousMetals: { icon: "💍", label: "precious metals" },
  gems: { icon: "💎", label: "gems" },
  coal: { icon: "⚫", label: "coal" },
  oil: { icon: "🛢️", label: "oil" },
  gas: { icon: "💨", label: "gas" },
  plutonium: { icon: "☢️", label: "plutonium" },
  antimatter: { icon: "✨", label: "antimatter" },
};

const ORDER = Object.keys(RESOURCE_META) as ResourceId[];

export interface StockLine {
  id: ResourceId;
  icon: string;
  label: string;
  amount: string;
  /** nothing in the larder yet — rendered dimmed but never hidden */
  empty: boolean;
}

/**
 * Every resource the island has ever stocked plus everything its age has
 * unlocked, in age order. A zero stays visible — an empty larder is the most
 * important reading on the panel, and an unlocked ore is an invitation.
 */
export function stockLines(
  stocks: Partial<Record<ResourceId, number>>,
  unlocked: readonly ResourceId[] = [],
): StockLine[] {
  return ORDER.filter((id) => stocks[id] !== undefined || unlocked.includes(id)).map((id) => {
    const n = stocks[id] ?? 0;
    const amount = n >= 10_000 ? `${Math.round(n / 1000)}k` : String(Math.floor(n));
    return { id, ...RESOURCE_META[id], amount, empty: n < 1 };
  });
}

/** The key-holder's larder, pinned under their island's name. */
export function updateStocks(island: Island): void {
  const list = document.getElementById("stocks");
  if (!list) return;
  const lines = stockLines(island.stocks, AGE_RESOURCES[island.age] ?? []);
  list.hidden = lines.length === 0;
  list.replaceChildren(
    ...lines.map((line) => {
      const li = document.createElement("li");
      li.dataset.resource = line.id;
      if (line.empty) li.classList.add("stock-empty");
      const icon = document.createElement("span");
      icon.className = "stock-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = line.icon;
      const amount = document.createElement("b");
      amount.textContent = line.amount;
      const label = document.createElement("span");
      label.className = "stock-label";
      label.textContent = line.label;
      li.append(icon, amount, label);
      return li;
    }),
  );
}
