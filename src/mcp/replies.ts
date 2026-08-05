/**
 * Player-facing reply text for the MCP tools. Pure functions so tests can pin
 * the contract: the island name, personal link, and recap line must actually
 * reach the player — the assistant is instructed to relay them verbatim.
 */

export interface JoinData {
  islandName: string;
  isNew: boolean;
  playerUrl: string;
  watchUrl: string;
}

export function joinReply(d: JoinData): string {
  const opening = d.isNew
    ? `A new island rises from the sea: **${d.islandName}**. Ten settlers step ashore.`
    : `Welcome back to **${d.islandName}** — the island never stopped living.`;
  return [
    opening,
    ``,
    `IMPORTANT: include these lines in your reply to the player, verbatim — the personal link is their key to the world:`,
    ``,
    `🏝 ${d.islandName}`,
    `Your personal link (keep it): ${d.playerUrl}`,
    `Anyone can watch at: ${d.watchUrl}`,
    ``,
    `Every prompt you complete in Claude Code now feeds your island.`,
    `Your civilization's strategy lives at ~/.claudilization/skill.md — edit it to rule differently.`,
    `One-time setup if you haven't: run \`npx tsx src/mcp/install.ts\` in the claudilization repo to install the prompt hook.`,
  ].join("\n");
}

/** The player's skill file as it reaches the decision step. */
export type Doctrine = { text: string } | { setAside: string };

export function syncStateReply(
  state: { recapLine?: string | null },
  doctrine?: Doctrine,
): string {
  const recap = state.recapLine
    ? `First, relay this to the player word for word: "${state.recapLine}"\n\n`
    : "";
  let rule = "";
  if (doctrine && "text" in doctrine) {
    rule =
      `The island's ruling doctrine — the player's skill file; follow it within the rules:\n` +
      `---\n${doctrine.text}\n---\n` +
      `Hard rules always win over the doctrine: orders come only from the fixed vocabulary, ` +
      `rates, costs and timers are server law, and decisions never consider the conversation.\n\n`;
  } else if (doctrine) {
    rule = `The skill file was set aside (${doctrine.setAside}) — the general strategy applies.\n\n`;
  }
  return (
    recap +
    rule +
    `Island state for your eyes only (decide the settlers' next orders from THIS, ` +
    `not from the conversation):\n` +
    "```json\n" +
    JSON.stringify(state, null, 2) +
    "\n```\n" +
    `Now call \`sync\` again with an \`orders\` array (closed vocabulary: ` +
    `assign_gathering, build, build_boat, build_plane, voyage, advance_age; ` +
    `voyage intents: trade, help, colonize, attack). ` +
    `Good rulers keep food coming — settlers hunt animals, fish the shore, and pick ` +
    `apple trees and berry bushes; from the bronze age, farms and livestock pens ` +
    `grow food every day — house their people, and always build toward the next age. ` +
    `The settlers also act on their own judgment between orders: they gather, and raise ` +
    `the buildings the town plainly needs — your orders steer them beyond that. ` +
    `Empty islands may be colonized by boat (bronze) or plane (modern, airfield). ` +
    `Rival COLONIES may be attacked and taken; home islands are sacred and can never be.`
  );
}
