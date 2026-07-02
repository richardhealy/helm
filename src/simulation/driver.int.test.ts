import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { tickVehicle } from "./driver";

let vehicleId: string;
let deliveryId: string;
let routeId: string;

beforeAll(async () => {
  const v = await prisma.vehicle.create({ data: { label: "sim-test" } });
  vehicleId = v.id;
  const d = await prisma.delivery.create({
    data: { address: "Dest", lat: 0, lng: 1, status: "assigned", vehicleId, sequence: 0 },
  });
  deliveryId = d.id;
  // straight ~111km eastbound line; one stop at the end
  const route = await prisma.route.create({
    data: {
      vehicleId,
      status: "active",
      geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
      distance: 111_320,
      duration: 3600,
      progressMeters: 0,
    },
  });
  routeId = route.id;
  await prisma.routeLeg.create({
    data: { routeId, sequence: 0, distance: 111_320, duration: 3600, eta: new Date(), toDeliveryId: deliveryId },
  });
});

afterAll(async () => {
  await prisma.routeLeg.deleteMany({ where: { routeId } });
  await prisma.route.deleteMany({ where: { vehicleId } });
  await prisma.positionPing.deleteMany({ where: { vehicleId } });
  await prisma.delivery.deleteMany({ where: { id: deliveryId } });
  await prisma.vehicle.delete({ where: { id: vehicleId } });
  await prisma.$disconnect();
});

describe("tickVehicle", () => {
  it("moves the vehicle and sets it en_route on the first tick", async () => {
    const r = await tickVehicle(vehicleId, { speedMps: 100, dtSeconds: 1 });
    expect(r.moved).toBe(true);
    expect(r.completed).toBe(false);

    const v = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    expect(v.status).toBe("en_route");
    expect(v.lng).toBeGreaterThan(0); // advanced eastward
    const pings = await prisma.positionPing.count({ where: { vehicleId } });
    expect(pings).toBe(1);
  });

  it("delivers the stop and completes the route when it reaches the end", async () => {
    // one giant tick to force arrival + completion
    const r = await tickVehicle(vehicleId, { speedMps: 1_000_000, dtSeconds: 1 });
    expect(r.arrived).toContain(deliveryId);
    expect(r.completed).toBe(true);

    const d = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(d.status).toBe("delivered");
    expect(d.completedAt).not.toBeNull();

    const route = await prisma.route.findUniqueOrThrow({ where: { id: routeId } });
    expect(route.status).toBe("completed");
    const v = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    expect(v.status).toBe("idle");
  });
});
