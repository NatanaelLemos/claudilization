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

/**
 * Validate an untrusted payload against the closed order vocabulary.
 * Throws on anything malformed or out of vocabulary.
 */
export function parseOrders(input: unknown): Order[] {
  return OrdersSchema.parse(input) as Order[];
}
