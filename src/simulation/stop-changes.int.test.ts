import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { assignDelivery, unassignDelivery } from "@/deliveries/orders/deliveries";
import { tickVehicle } from "./driver";

// Van A has an optimized route through stops 1 and 2. Once it is on the road,
// the dispatcher pulls stop 1 back to the pool and moves stop 2 to van B.
// Van A still drives its old geometry, but it must not deliver either stop.

let vanA: string;
let vanB: string;
let stop1: string;
let stop2: string;
let late: string;
let routeId: string;

beforeAll(async () => {
  vanA = (await prisma.vehicle.create({ data: { label: "stop-changes-A" } })).id;
  vanB = (await prisma.vehicle.create({ data: { label: "stop-changes-B" } })).id;
  stop1 = (
    await prisma.delivery.create({
      data: { address: "Stop 1", lat: 0, lng: 0.5, status: "assigned", vehicleId: vanA, sequence: 0 },
    })
  ).id;
  stop2 = (
    await prisma.delivery.create({
      data: { address: "Stop 2", lat: 0, lng: 1, status: "assigned", vehicleId: vanA, sequence: 1 },
    })
  ).id;
  // ~111 km eastbound line with a stop halfway and one at the end.
  routeId = (
    await prisma.route.create({
      data: {
        vehicleId: vanA,
        status: "active",
        geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
        distance: 111_320,
        duration: 3600,
      },
    })
  ).id;
  await prisma.routeLeg.createMany({
    data: [
      { routeId, sequence: 0, distance: 55_660, duration: 1800, eta: new Date(), toDeliveryId: stop1 },
      { routeId, sequence: 1, distance: 55_660, duration: 1800, eta: new Date(), toDeliveryId: stop2 },
    ],
  });
  // Assigned to van A after its route was optimized, so it is not on the route.
  late = (
    await prisma.delivery.create({
      data: { address: "Late stop", lat: 0, lng: 2, status: "assigned", vehicleId: vanA },
    })
  ).id;
});

afterAll(async () => {
  const ids = [stop1, stop2, late];
  await prisma.routeLeg.deleteMany({ where: { routeId } });
  await prisma.route.deleteMany({ where: { vehicleId: { in: [vanA, vanB] } } });
  await prisma.positionPing.deleteMany({ where: { vehicleId: { in: [vanA, vanB] } } });
  await prisma.dispatchEvent.deleteMany({
    where: { OR: [{ vehicleId: { in: [vanA, vanB] } }, { deliveryId: { in: ids } }] },
  });
  await prisma.delivery.deleteMany({ where: { id: { in: ids } } });
  await prisma.vehicle.deleteMany({ where: { id: { in: [vanA, vanB] } } });
  await prisma.$disconnect();
});

describe("stop changes while a van is on the road", () => {
  it("only puts the route's own stops en route when the van departs", async () => {
    await tickVehicle(vanA, { speedMps: 100, dtSeconds: 1 });

    const rows = await prisma.delivery.findMany({
      where: { id: { in: [stop1, stop2, late] } },
      orderBy: { address: "asc" },
    });
    expect(rows.map((r) => [r.address, r.status])).toEqual([
      ["Late stop", "assigned"],
      ["Stop 1", "en_route"],
      ["Stop 2", "en_route"],
    ]);
  });

  it("does not deliver stops that were taken off the van", async () => {
    await unassignDelivery(stop1);
    await assignDelivery(stop2, vanB);

    const r = await tickVehicle(vanA, { speedMps: 1_000_000, dtSeconds: 1 });
    expect(r.completed).toBe(true);
    expect(r.arrived).toEqual([]);

    const s1 = await prisma.delivery.findUniqueOrThrow({ where: { id: stop1 } });
    expect(s1.status).toBe("unassigned");
    expect(s1.vehicleId).toBeNull();
    expect(s1.completedAt).toBeNull();

    const s2 = await prisma.delivery.findUniqueOrThrow({ where: { id: stop2 } });
    expect(s2.status).toBe("assigned");
    expect(s2.vehicleId).toBe(vanB);
    expect(s2.completedAt).toBeNull();

    const arrivals = await prisma.dispatchEvent.count({
      where: { type: "arrived", deliveryId: { in: [stop1, stop2] } },
    });
    expect(arrivals).toBe(0);
  });
});
