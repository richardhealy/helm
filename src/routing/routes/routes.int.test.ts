import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { persistRoute, getActiveRoute } from "./routes";
import type { OptimizedTrip } from "@/routing/optimize/optimize";

let vehicleId: string;
const deliveryIds: string[] = [];

beforeAll(async () => {
  const v = await prisma.vehicle.create({ data: { label: "route-test" } });
  vehicleId = v.id;
  for (const addr of ["A", "B"]) {
    const d = await prisma.delivery.create({
      data: { address: addr, lat: 51.5, lng: -0.12, status: "assigned", vehicleId },
    });
    deliveryIds.push(d.id);
  }
});

afterAll(async () => {
  await prisma.routeLeg.deleteMany({ where: { toDeliveryId: { in: deliveryIds } } });
  await prisma.route.deleteMany({ where: { vehicleId } });
  await prisma.delivery.deleteMany({ where: { id: { in: deliveryIds } } });
  await prisma.vehicle.delete({ where: { id: vehicleId } });
  await prisma.$disconnect();
});

describe("persistRoute", () => {
  it("persists a route with per-stop ETAs and sequences", async () => {
    const trip: OptimizedTrip = {
      geometry: { type: "LineString", coordinates: [[-0.12, 51.5], [-0.1, 51.52]] },
      distance: 3000,
      duration: 600,
      legs: [
        { distance: 1000, duration: 200 },
        { distance: 2000, duration: 400 },
      ],
      orderedStopIndices: [1, 0],
    };
    // visiting order: deliveryIds[1] then deliveryIds[0]
    const ordered = [deliveryIds[1], deliveryIds[0]];
    const start = new Date("2026-07-03T09:00:00Z");

    const { routeId } = await persistRoute(vehicleId, ordered, trip, start);
    expect(routeId).toBeTruthy();

    const active = await getActiveRoute(vehicleId);
    expect(active?.legs).toHaveLength(2);
    // first stop ETA = start + 200s
    expect(active!.legs[0].eta.toISOString()).toBe("2026-07-03T09:03:20.000Z");
    // second stop ETA = start + 200s + 400s
    expect(active!.legs[1].eta.toISOString()).toBe("2026-07-03T09:10:00.000Z");
    expect(active!.legs[0].toDeliveryId).toBe(deliveryIds[1]);

    const first = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryIds[1] } });
    expect(first.sequence).toBe(0);
  });
});
