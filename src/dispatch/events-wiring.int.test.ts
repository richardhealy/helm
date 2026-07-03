import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { assignDelivery, unassignDelivery } from "@/deliveries/orders/deliveries";

let vehicleId: string;
let deliveryId: string;
const eventIds: string[] = [];

beforeAll(async () => {
  const v = await prisma.vehicle.create({ data: { label: "evt-test" } });
  vehicleId = v.id;
  const d = await prisma.delivery.create({
    data: { address: "Somewhere", lat: 51.5, lng: -0.1, status: "unassigned" },
  });
  deliveryId = d.id;
});

afterAll(async () => {
  await prisma.dispatchEvent.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.delivery.deleteMany({ where: { id: deliveryId } });
  await prisma.vehicle.delete({ where: { id: vehicleId } });
  await prisma.$disconnect();
});

describe("event wiring", () => {
  it("records an 'assigned' event when a delivery is assigned", async () => {
    await assignDelivery(deliveryId, vehicleId);
    const events = await prisma.dispatchEvent.findMany({
      where: { deliveryId, type: "assigned" },
    });
    eventIds.push(...events.map((e) => e.id));
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].actor).toBe("dispatcher");

    await unassignDelivery(deliveryId);
    const un = await prisma.dispatchEvent.findMany({
      where: { deliveryId, type: "unassigned" },
    });
    eventIds.push(...un.map((e) => e.id));
    expect(un.length).toBeGreaterThanOrEqual(1);
  });
});
