import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { redispatchCompletedRoutes } from "./driver";

let vehicleId: string;
let deliveryId: string;
let routeId: string;

beforeAll(async () => {
  const v = await prisma.vehicle.create({ data: { label: "redispatch-test", status: "idle" } });
  vehicleId = v.id;
  const d = await prisma.delivery.create({
    data: { address: "Dest", lat: 0, lng: 1, status: "delivered", vehicleId, sequence: 0 },
  });
  deliveryId = d.id;
  const r = await prisma.route.create({
    data: {
      vehicleId,
      status: "completed",
      geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
      distance: 1000,
      duration: 60,
      progressMeters: 1000,
    },
  });
  routeId = r.id;
});

afterAll(async () => {
  await prisma.route.deleteMany({ where: { vehicleId } });
  await prisma.delivery.deleteMany({ where: { id: deliveryId } });
  await prisma.vehicle.delete({ where: { id: vehicleId } });
  await prisma.$disconnect();
});

describe("redispatchCompletedRoutes", () => {
  it("resets a completed route to active at progress 0 and its stops to en_route", async () => {
    const count = await redispatchCompletedRoutes();
    expect(count).toBeGreaterThanOrEqual(1);

    const route = await prisma.route.findUniqueOrThrow({ where: { id: routeId } });
    expect(route.status).toBe("active");
    expect(route.progressMeters).toBe(0);

    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(delivery.status).toBe("en_route");
  });
});
