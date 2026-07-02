import { z } from "zod";

/**
 * The normalized ingestion contract. Every position source — the simulator
 * today, a telematics adapter later — must produce this shape. Nothing above
 * `src/fleet/ingest` should reference any source directly.
 */
export const positionPingInput = z.object({
  vehicleId: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  heading: z.number().min(0).max(360),
  speed: z.number().min(0),
  source: z.enum(["simulation", "telematics"]).default("simulation"),
  timestamp: z.coerce.date().optional(),
});

// `z.input` (not `z.infer`/`z.output`): `source` has a default, so it is
// optional for callers; `ingestPing` applies the default when parsing.
export type PositionPingInput = z.input<typeof positionPingInput>;
