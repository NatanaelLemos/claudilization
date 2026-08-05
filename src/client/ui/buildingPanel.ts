import { buildingSpec } from "../../shared/buildings";
import { CIVS } from "../../shared/civs";
import type { Building, Island } from "../../shared/types";
import { RESOURCE_META } from "./stocks";

/** One line of lore per building type — what the place is, in the island's voice. */
const LORE: Record<string, string> = {
  // leisure
  "dancing-ground": "Packed earth ringed with stones; drums at dusk, and nobody counts the hours.",
  garden: "Beds of flowers and a shaded bench — planted for no profit at all.",
  "bathing-lake": "Cool water and warm rocks; the day's work waits on the shore.",
  "pleasure-garden": "Marble walks, a singing fountain, and time gladly lost.",
  "village-green": "A maypole, two benches, and the whole town on a fine day.",
  "fountain-plaza": "Carved water dancing over stone; the city's favorite excuse.",
  "city-park": "Iron gates, old trees and a pond — a green breath inside the streets.",
  funfair: "A great wheel turning against the sky; shrieks of joy carry for miles.",
  "gravity-garden": "Groves drifting on humming rings — a stroll above the ground.",
  // stone
  hut: "A thatched shelter of bough and hide — the simplest roof a family can raise.",
  campfire: "The village hearth; settlers gather here when the day's work is done.",
  granary: "Raised stores that keep the harvest dry and the rats out.",
  toolmaker: "Benches of antler and sinew where better tools take shape.",
  "storyteller-circle": "Worn stones in a ring; the old tales keep the people one.",
  "flint-knapper": "Chips of sharp stone fly here from dawn to dusk.",
  "drying-rack": "Lattices where fish and hides stiffen in the sea wind.",
  "fishing-hut": "Nets, hooks and gutting knives kept an arm from the surf.",
  "burial-mound": "The ancestors sleep beneath; the living walk softer for it.",
  "shaman-tent": "Smoke, herbs and murmured omens under painted hide.",
  palisade: "A wall of sharpened stakes between the village and the dark.",
  smokehouse: "Slow smoke that turns the day's catch into winter stores.",
  "elder-lodge": "A long hall where several families live under the elders' eye.",
  "stone-circle": "Standing stones raised to mark the sun's turning.",
  "hide-tanner": "Reeking pits that turn raw hides into leather.",
  // bronze
  farm: "Tilled rows that feed the island every day without fail.",
  "livestock-pen": "Penned goats and pigs — a slower but steady larder.",
  dock: "Timber piers; with a dock the island can lay keels and launch voyages.",
  boat: "A hull on the slipway — once seaworthy it joins the fleet at the dock.",
  "bronze-forge": "Copper and tin melt together here into something harder than either.",
  "copper-mine": "A shaft sunk after the green-streaked rock.",
  longhouse: "A great timber hall housing several families end to end.",
  "tin-mine": "A shaft chasing the grey metal that bronze demands.",
  kiln: "A roaring oven that fires clay hard and true.",
  "pottery-workshop": "Wheels and wet clay; jars for oil, grain and trade.",
  weaver: "Looms clacking out cloth from wool and flax.",
  bathhouse: "Heated water and gossip in equal measure.",
  "trading-post": "A counter open to any sail that comes in peace.",
  "bronze-armory": "Racked spears and bronze-bossed shields, oiled and counted.",
  "chariot-works": "Wheelwrights and joiners building the age's fastest weapon.",
  shrine: "A quiet house for the island's gods.",
  brewery: "Vats where surplus grain becomes courage.",
  // iron
  "iron-mine": "Deep galleries after the dark ore that ends the bronze world.",
  blacksmith: "Hammer-song from first light; iron bends here.",
  steelworks: "Furnaces hot enough to coax steel from iron.",
  watchtower: "A high platform watching the horizon for sails.",
  barracks: "Drilled ranks sleep, eat and train here.",
  roundhouse: "A broad ringed dwelling for many families.",
  "stone-wall": "Dressed stone in place of stakes — a wall meant to last.",
  arsenal: "Weapons stored dry, sharp and ready.",
  stable: "Stalls and hay for the island's horses.",
  gristmill: "Turning stones that grind grain into flour.",
  well: "Clean water at the village heart, whatever the weather.",
  "moot-hall": "Where disputes are argued and law is spoken.",
  "siege-workshop": "Rams and engines built to open other people's gates.",
  "charcoal-burner": "Smouldering clamps turning wood into furnace fuel.",
  "toll-bridge": "A crossing that pays for itself, traveler by traveler.",
  // classical
  temple: "Marble columns for the gods.",
  amphitheater: "Tiered stone where the whole island laughs and weeps together.",
  goldsmith: "Fine hands working the yellow metal.",
  "marble-quarry": "White stone cut in blocks from the hillside.",
  forum: "The open square where politics and produce trade places.",
  aqueduct: "Arched channels walking water across the island.",
  thermae: "Grand baths — hot, warm and cold in marble.",
  library: "Scrolls gathered from every sea.",
  "silver-mine": "Veins of moonlight followed underground.",
  "gem-cutter": "Facets teased out of rough stones.",
  mint: "Where metal is struck into money the ocean trusts.",
  hippodrome: "Thundering circuits of hoof and wheel.",
  insula: "Stacked city dwellings — many families, one staircase.",
  "senate-hall": "Long benches, longer speeches.",
  "sculptors-guild": "Chisels finding figures inside the marble.",
  // medieval
  keep: "The stronghold at the island's heart — last refuge, first symbol.",
  monastery: "Cloisters of quiet work and kept knowledge.",
  windmill: "Sails on a tower, grinding wind into flour.",
  "market-hall": "A roofed market where everything has a price.",
  "castle-wall": "High curtain walls no ladder loves.",
  barbican: "A fortified gate that makes visitors think twice.",
  cathedral: "A generation's labor pointed at the sky.",
  guildhall: "Where the crafts meet, set standards and keep secrets.",
  tavern: "Ale, rumor and the occasional song.",
  manor: "A great house and its cottages — many families under one roof.",
  apothecary: "Dried herbs and careful doses.",
  "tourney-grounds": "Lists and stands for blunted war.",
  scriptorium: "Patient hands copying books line by line.",
  watermill: "A wheel in the stream doing the work of twenty arms.",
  "bell-tower": "The hours, alarms and joys of the island, rung out.",
  // renaissance
  "printing-house": "Movable type — ideas by the hundredweight.",
  observatory: "Lenses aimed at the clockwork of heaven.",
  "coal-mine": "Black seams that will one day drive engines.",
  academy: "Masters teaching everything measurable, and some things not.",
  bank: "Ledgers, vaults and quiet power.",
  "opera-house": "Gilded tiers for the loudest beauty.",
  "cartographers-hall": "The ocean drawn smaller and truer with every voyage.",
  glassworks: "Furnace-blown panes and vessels, clear as air.",
  clockmaker: "Ticking cabinets that cut the day into honest pieces.",
  "alchemist-lab": "Smoke and glassware in pursuit of transformation.",
  gallery: "The island's finest work, hung where all can judge it.",
  townhouse: "Tall brick homes for the rising families.",
  "anatomy-theater": "Ringed benches around the surgeon's table.",
  gunsmith: "Barrels bored and locks fitted — the new argument.",
  "botanical-garden": "Living specimens from every latitude.",
  // industrial
  factory: "Lines and looms under one smoking roof.",
  "railway-yard": "Rails, switches and rolling stock marshalled by whistle.",
  "oil-derrick": "A timber tower nodding over the black spring.",
  gasworks: "Coal baked into town gas for lamp and stove.",
  "rolling-mill": "Steel squeezed into rails, plate and girder.",
  "textile-mill": "Thread by the mile, cloth by the acre.",
  "coking-plant": "Coal purified into coke for the great furnaces.",
  "telegraph-office": "News that outruns any sail.",
  tenement: "Brick stacked high; many families in little rooms.",
  "train-station": "Arrivals, departures and the age's heartbeat.",
  refinery: "Crude split into fuels the machines can drink.",
  "newspaper-press": "Yesterday, inked and folded by morning.",
  cannery: "The harvest sealed in tin against the lean months.",
  "steam-engine-house": "Beam engines breathing for the whole works.",
  exchange: "Shouted numbers deciding distant fortunes.",
  // modern
  "power-plant": "Turbines feeding the island's grid.",
  airfield: "A strip and hangars; with an airfield the island can build planes.",
  plane: "An airframe in the hangar — once finished it joins the fleet.",
  reactor: "A tamed sun behind thick concrete.",
  "broadcast-tower": "One voice reaching every roof at once.",
  hospital: "Wards, theaters and second chances.",
  university: "Research and argument at industrial scale.",
  skyscraper: "Steel and glass stood on end.",
  "apartment-block": "Elevators and balconies — a village stood upright.",
  "highway-depot": "Asphalt arteries maintained around the clock.",
  "petrochemical-plant": "Pipes on pipes turning oil into everything.",
  stadium: "A roaring bowl for game days.",
  "research-lab": "White coats probing the edge of the known.",
  "water-treatment": "The unglamorous machinery of not getting sick.",
  cinema: "Dark rows and a bright rectangle of elsewhere.",
  "radar-station": "Sweeping dishes that see through night and fog.",
  // future
  "fusion-core": "A star bottled and put to work.",
  "space-elevator": "A ribbon from the harbor to orbit.",
  "antimatter-lab": "Containment fields around the most expensive stuff there is.",
  arcology: "A whole city folded into one habitat.",
  "launch-complex": "Gantries and countdowns to somewhere else.",
  "quantum-computer": "Answers pulled from superposition, cold as space.",
  "ai-nexus": "A mind of minds humming beneath the floor.",
  "cryo-vault": "The patient, sleeping their way to later.",
  terraformer: "Weather, soil and coastline, adjustable.",
  nanoforge: "Matter assembled atom by atom to spec.",
  skyfarm: "Stacked fields glowing under grow-light.",
  "graviton-plant": "Machinery leaning on gravity itself.",
  "holo-theater": "Stages of light you can walk through.",
  "weather-array": "Tomorrow's rain, scheduled.",
  "dyson-relay": "Sunlight harvested far above, beamed home.",
};

export interface BuildingCard {
  title: string;
  /** age + stage strap line, e.g. "bronze age · under construction — 40%" */
  meta: string;
  description: string;
  facts: string[];
}

function titleCase(type: string): string {
  return type
    .split("-")
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

function costLine(cost: Partial<Record<string, number>>): string {
  return Object.entries(cost)
    .map(([id, n]) => {
      const meta = RESOURCE_META[id as keyof typeof RESOURCE_META];
      return meta ? `${meta.icon} ${n} ${meta.label}` : `${n} ${id}`;
    })
    .join(" · ");
}

function nameList(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/** Everything the inspector card says about one building, as plain lines. */
export function buildingCard(building: Building, island: Island): BuildingCard {
  const spec = buildingSpec(building.type);
  const title = titleCase(building.type);
  const age = spec ? `${spec.age} age` : "unknown age";
  const description =
    LORE[building.type] ??
    (buildingSpec(building.type)?.wonder
      ? `A wonder of the ${CIVS[island.civ].label} people. Generations bent their backs to raise it, and every islander walks taller in its shadow.`
      : `A structure raised by the people of ${island.name}.`);

  let stage = "";
  if (building.stage === "site") stage = " · staked site";
  else if (building.stage === "construction" && spec) {
    const pct = Math.min(99, Math.floor((building.progress / spec.buildSeconds) * 100));
    stage = ` · under construction — ${pct}%`;
  }

  const facts: string[] = [];
  const complete = building.stage === "complete";

  if (spec && Object.keys(spec.cost).length) {
    facts.push(`${complete ? "Built from" : "Being raised from"} ${costLine(spec.cost)}`);
  }
  if (spec && !complete) {
    const remaining = Math.max(0, Math.ceil(spec.buildSeconds - building.progress));
    facts.push(`${remaining} worker-seconds of labor remain`);
  }
  if (spec?.houses) {
    if (complete) {
      const tenants = island.settlers
        .filter((s) => s.houseId === building.id)
        .map((s) => (s.adult ? s.name : `${s.name} (child)`));
      facts.push(
        tenants.length
          ? `Shelter for ${spec.houses} — home to ${nameList(tenants)} (${tenants.length}/${spec.houses})`
          : `Shelter for ${spec.houses} — no one has moved in yet`,
      );
    } else {
      facts.push(`Will shelter ${spec.houses} settlers once complete`);
    }
  }
  if (spec?.foodPerDay) {
    facts.push(
      complete
        ? `Grows ${RESOURCE_META.food.icon} ${spec.foodPerDay} food each day, straight into the stores`
        : `Will grow ${RESOURCE_META.food.icon} ${spec.foodPerDay} food each day once complete`,
    );
  }
  if (spec?.converts) {
    const { from, to, perDay } = spec.converts;
    const line = `${RESOURCE_META[from].icon} ${perDay} ${RESOURCE_META[from].label} into ${RESOURCE_META[to].icon} ${perDay} ${RESOURCE_META[to].label} each day`;
    facts.push(complete ? `Refines ${line}` : `Will refine ${line} once complete`);
  }
  if (spec?.joy) {
    facts.push(
      spec.wonder
        ? `The pride of the island — happiness +${spec.joy}`
        : `Happiness +${spec.joy} — settlers while whole days away here instead of working`,
    );
  }
  if (complete && !spec?.converts) {
    facts.push("Consumes nothing day to day — only settlers eat from the stores");
  }

  return { title, meta: `${age}${stage}`, description, facts };
}

// ------------------------------------------------------------------- DOM

let openBuildingId: string | undefined;
let escBound = false;

function panelEl(): HTMLElement | null {
  return document.getElementById("building-panel");
}

function render(island: Island, building: Building): void {
  const panel = panelEl();
  if (!panel) return;
  const card = buildingCard(building, island);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "panel-close";
  close.setAttribute("aria-label", "Close building details");
  close.textContent = "×";
  close.addEventListener("click", hideBuildingPanel);

  const title = document.createElement("h2");
  title.textContent = card.title;

  const meta = document.createElement("p");
  meta.className = "building-meta";
  meta.textContent = card.meta;

  const desc = document.createElement("p");
  desc.className = "building-desc";
  desc.textContent = card.description;

  const facts = document.createElement("ul");
  facts.append(
    ...card.facts.map((f) => {
      const li = document.createElement("li");
      li.textContent = f;
      return li;
    }),
  );

  panel.replaceChildren(close, title, meta, desc, facts);
}

/** Open the inspector for a building, anchored near the click point. */
export function showBuildingPanel(island: Island, building: Building, at: { x: number; y: number }): void {
  const panel = panelEl();
  if (!panel) return;
  openBuildingId = building.id;
  render(island, building);
  panel.hidden = false;
  // clamp inside the viewport once the card has a size
  const rect = panel.getBoundingClientRect();
  const x = Math.min(Math.max(12, at.x + 14), window.innerWidth - rect.width - 12);
  const y = Math.min(Math.max(12, at.y - rect.height / 2), window.innerHeight - rect.height - 12);
  panel.style.left = `${x}px`;
  panel.style.top = `${y}px`;

  if (!escBound) {
    escBound = true;
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hideBuildingPanel();
    });
  }
}

/** Live pulses re-render the open card so progress and tenants stay honest. */
export function refreshBuildingPanel(island: Island): void {
  if (!openBuildingId) return;
  const building = island.buildings.find((b) => b.id === openBuildingId);
  if (!building) {
    hideBuildingPanel(); // razed or lost — a card for a ghost helps no one
    return;
  }
  render(island, building);
}

export function hideBuildingPanel(): void {
  openBuildingId = undefined;
  const panel = panelEl();
  if (panel) panel.hidden = true;
}
