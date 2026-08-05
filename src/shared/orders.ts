import { z } from "zod";
import type { Order, ResourceId } from "./types";

const RESOURCES: [ResourceId, ...ResourceId[]] = [
  "food", "wood", "stone", "copper", "tin", "iron", "steel", "marble",
  "gold", "silver", "preciousMetals", "gems", "coal", "oil", "gas",
  "plutonium", "antimatter",
];

const MAX_ORDERS = 10;

const OrderSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("assign_gathering"),
    resource: z.enum(RESOURCES),
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
]);

const OrdersSchema = z.array(OrderSchema).max(MAX_ORDERS);

/**
 * Validate an untrusted payload against the closed order vocabulary.
 * Throws on anything malformed or out of vocabulary.
 */
export function parseOrders(input: unknown): Order[] {
  return OrdersSchema.parse(input) as Order[];
}
