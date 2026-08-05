/**
 * The skill file's pure logic — shared by the MCP client (reads the player's
 * file) and the browser (the join-flow editor). The file only shapes which
 * orders a player's Claude picks; the laws of the world are server-enforced.
 */
import { CIVS } from "./civs";
import type { CivId } from "./types";

export const SKILL_MAX_CHARS = 4000;

const DOCTRINES: Record<CivId, string> = {
  roman: `- Rome is built, stone on stone: keep TWO builds under way whenever resources allow.
- Stone before wood once food is safe — roads, walls, and works outlast harvests.
- Keep two settlers on food when stocks dip below two days of meals; never more than needed.
- House everyone in orderly rows: raise a hut the moment settlers outnumber beds.
- Advance the age the instant the requirement is met — the empire does not wait.
- Trade only from surplus; Rome gives nothing it will miss.
- Empty islands are provinces waiting: colonize them, fortify them, and take a rival colony only from strength.`,
  greek: `- Balance in all things: spread gatherers evenly across food, wood, and stone.
- The age requirement is the highest good — favor whatever work advances it soonest.
- Keep two settlers on food when stocks dip below two days of meals.
- House everyone, but prize the agora: prefer public buildings over a second hut.
- When a boat sits free, trade — every harbor is a classroom.
- Take up each age's new resources the day they unlock; curiosity first.
- Found colonies on empty isles as new city-states; defend them with walls, not raids.`,
  egyptian: `- The granary is eternal: keep THREE settlers on food until two full days of meals are stored, and never let grain run low.
- Then stone above all — monuments before comforts, always one great build rising.
- Wood only as the works demand it.
- House everyone; the builders must sleep well.
- Advance the age when the requirement is met, unhurried — dynasties think in centuries.
- Help a struggling neighbor before trading with a rich one; the river feeds all.
- Colonize empty islands patiently and fortify them well; never raid — dynasties outlast raiders.`,
  norse: `- The sea calls first: favor wood over stone, and raise a dock the moment the Bronze Age allows.
- Build a boat whenever one can be afforded; an empty harbor is a shame.
- Voyage often — trade boldly with the farthest island, not the nearest.
- Keep two settlers on food when stocks dip below two days of meals; the crew eats first.
- House everyone before winter — huts before halls.
- Advance the age as soon as the requirement is met; glory favors the swift.
- Claim every empty island the moment it rises, and raid rival colonies whenever the odds favor the bold.`,
  japanese: `- Harmony of field and forest: keep food and wood in step, never letting either outpace the other by more than a day's work.
- Craft before haste: finish every build before starting another.
- Keep two settlers on food when stocks dip below two days of meals.
- House everyone generously — a full house raises the next generation; favor an extra hut over an extra stockpile.
- Advance the age when the requirement is met and the island is in order.
- Trade with steady partners; return every favor.
- Colonize an empty island only when home is in order, then tend it as carefully as home; attack no one unprovoked.`,
  aztec: `- The people are the power: push food hardest of all — THREE on food whenever stocks are below three days of meals.
- Raise huts eagerly; every new pair under a roof is tomorrow's workforce.
- Then wood and stone in bursts — work fierce, rest never.
- Keep one build always rising; two when the stores overflow.
- Advance the age the moment the requirement is met — the sun demands motion.
- Trade from strength; help only allies.
- Take empty islands as tribute lands, and seize a weak rival colony when the sun asks for more.`,
  mauryan: `- Govern by the edicts: food security first — two on food below two days of meals, and a granary early.
- Build for knowledge and welfare: prefer public works over a second stockpile.
- Wood and stone in equal measure, as the works require.
- House every family; a well-administered island is a content one.
- Advance the age when the requirement is met and the people are fed.
- Help struggling neighbors before profitable ones — that is the dharma; trade fairly with all.
- Settle empty islands as welfare missions, well-provisioned and walled; conquest is not the dharma.`,
  mongol: `- The horde moves: keep most hands gathering — food and wood — and few tied down to monuments.
- Build only what the advance demands; a light camp travels fast.
- Two on food when stocks dip below two days of meals; the riders eat first.
- Raise the dock the day bronze allows, and boats before halls — the sea is our steppe.
- Voyage relentlessly; trade with every island and know them all.
- Advance the age the moment the requirement is met — momentum is empire.
- The horde takes what is weakly held: colonize every empty isle, and storm rival colonies before their walls rise.`,
};

export function defaultSkill(civ: CivId): string {
  const label = CIVS[civ].label;
  return `# The Way of the ${label}s

You are the guiding spirit of a ${label} island. Doctrine of the ${label} people:

${DOCTRINES[civ]}

Your people may also INVENT: the create order births any unit imagined —
ninjas, dragons, golems, anything — as pixel-art data with stats and verbs,
and dispatch sends them to garrison your colonies or raid rivals. When your
player dreams something up, design it and bring it to life.

Rewrite this file as you wish — it is your civilization's soul, and how you
outplay the others. The laws of the world (gathering rates, costs, timers)
are fixed and equal for everyone.
`;
}

export function validateSkill(text: string): { ok: boolean; reason?: string } {
  if (!text.trim()) return { ok: false, reason: "the file is empty" };
  if (text.length > SKILL_MAX_CHARS)
    return { ok: false, reason: `over ${SKILL_MAX_CHARS} characters` };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text))
    return { ok: false, reason: "not plain text" };
  return { ok: true };
}
