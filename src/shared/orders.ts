import { z } from "zod";
import { CreationInputSchema, RESOURCE_IDS } from "./creations";
import type { Order } from "./types";

const MAX_ORDERS = 10;

/** How a dispatch/disband names a design: its id or its exact name. */
const CreationRef = z.string().trim().min(1).max(64);

const OrderSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("assign_gathering"),
    resource: z.enum(RESOURCE_IDS),
    count: z.number().int().positive(),
  }),
  z.object({ kind: z.literal("build"), building: z.string().min(1) }),
  z.object({ kind: z.literal("build_boat") }),
  z.object({ kind: z.literal("build_plane") }),
  z.object({
    kind: z.literal("voyage"),
    dest: z.string().min(1),
    intent: z.enum(["trade", "help", "colonize", "attack"]),
  }),
  z.object({ kind: z.literal("advance_age") }),
  // ── player-invented creations: data through the same closed gate ─────────
  z.object({ kind: z.literal("create"), creation: CreationInputSchema }),
  z.object({
    kind: z.literal("dispatch"),
    creation: CreationRef,
    dest: z.string().min(1).max(128),
    count: z.number().int().min(1).max(24).optional(),
  }),
  z.object({ kind: z.literal("disband"), creation: CreationRef }),
]);

const OrdersSchema = z.array(OrderSchema).max(MAX_ORDERS);

/** Every order kind this build of the vocabulary knows. */
const KNOWN_KINDS = new Set<string>(
  OrderSchema.options.map((option) => option.shape.kind.value),
);

/**
 * Validate an untrusted payload against the closed order vocabulary.
 * Throws on anything malformed or out of vocabulary.
 */
export function parseOrders(input: unknown): Order[] {
  return OrdersSchema.parse(input) as Order[];
}

/** A future-vocabulary order may be forwarded, but never a free-form blob. */
const FORWARD_KIND = /^[a-z][a-z0-9_]{0,31}$/;
const FORWARD_MAX_JSON = 8192;

/**
 * The INSTALLED CLIENT's parse — strict for every kind this build knows, but
 * forward-compatible: an order whose kind this build has never heard of is
 * passed through untouched for the server to judge. The server stays the only
 * law (it screens every order again), so a player's app keeps working when
 * the vocabulary grows before their next update.
 */
export function parseOrdersForward(input: unknown): unknown[] {
  if (!Array.isArray(input)) throw new Error("orders must be an array");
  if (input.length > MAX_ORDERS) throw new Error(`at most ${MAX_ORDERS} orders`);
  return input.map((entry) => {
    const kind =
      entry && typeof entry === "object" && typeof (entry as { kind?: unknown }).kind === "string"
        ? ((entry as { kind: string }).kind)
        : null;
    if (kind !== null && !KNOWN_KINDS.has(kind)) {
      if (!FORWARD_KIND.test(kind))
        throw new Error(`order kind ${JSON.stringify(kind)} is not a plain order name`);
      if (JSON.stringify(entry).length > FORWARD_MAX_JSON)
        throw new Error(`order ${JSON.stringify(kind)} is too large to forward`);
      return entry; // newer vocabulary than this build — the server decides
    }
    return OrderSchema.parse(entry);
  });
}

/** One order judged by the server: parsed law or a refusal it can report. */
export type ScreenedOrder =
  | { ok: true; order: Order }
  | { ok: false; order: unknown; reason: string };

/**
 * The SERVER's tolerant parse for the orders endpoint: batch shape is still a
 * hard error, but each order is judged on its own, so one unknown or
 * malformed order (say, from a newer or older client) refuses that order with
 * a reason instead of rejecting the player's whole batch.
 */
export function screenOrders(input: unknown): ScreenedOrder[] {
  if (!Array.isArray(input)) throw new Error("orders must be an array");
  if (input.length > MAX_ORDERS) throw new Error(`at most ${MAX_ORDERS} orders`);
  return input.map((entry) => {
    const result = OrderSchema.safeParse(entry);
    if (result.success) return { ok: true, order: result.data as Order };
    const kind =
      entry && typeof entry === "object" && typeof (entry as { kind?: unknown }).kind === "string"
        ? ((entry as { kind: string }).kind)
        : null;
    const reason =
      kind !== null && !KNOWN_KINDS.has(kind)
        ? `unknown order kind — not in this server's vocabulary`
        : result.error.issues[0]?.message ?? "malformed order";
    return { ok: false, order: entry, reason };
  });
}
