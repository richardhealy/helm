import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import {
  assignDelivery,
  unassignDelivery,
  DeliveryNotFoundError,
  DeliveryStateError,
} from "./deliveries";

let vehicleId: string;
const deliveryIds: string[] = [];

async function makeDelivery(
  status: "unassigned" | "en_route" | "delivered" | "failed",
) {
  const completedAt = status === "delivered" ? new Date() : null;
  const d = await prisma.delivery.create({
    data: {
      address: `lifecycle ${status}`,
      lat: 51.5,
      lng: -0.1,
      status,
      vehicleId: status === "unassigned" ? null : vehicleId,
      sequence: status === "unassigned" ? null : 0,
      completedAt,
    },
  });
  deliveryIds.push(d.id);
  return d;
}

beforeAll(async () => {
  const v = await prisma.vehicle.create({ data: { label: "lifecycle-test" } });
  vehicleId = v.id;
});

afterAll(async () => {
  await prisma.dispatchEvent.deleteMany({ where: { deliveryId: { in: deliveryIds } } });
  await prisma.delivery.deleteMany({ where: { id: { in: deliveryIds } } });
  await prisma.vehicle.delete({ where: { id: vehicleId } });
  await prisma.$disconnect();
});

describe("delivery lifecycle guards", () => {
  it("refuses to unassign a delivered stop and leaves it delivered", async () => {
    const d = await makeDelivery("delivered");

    await expect(unassignDelivery(d.id)).rejects.toBeInstanceOf(DeliveryStateError);

    const after = await prisma.delivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(after.status).toBe("delivered");
    expect(after.vehicleId).toBe(vehicleId);
    const events = await prisma.dispatchEvent.count({ where: { deliveryId: d.id } });
    expect(events).toBe(0);
  });

  it("refuses to reassign a delivered or failed stop", async () => {
    const delivered = await makeDelivery("delivered");
    const failed = await makeDelivery("failed");

    await expect(assignDelivery(delivered.id, vehicleId)).rejects.toBeInstanceOf(
      DeliveryStateError,
    );
    await expect(assignDelivery(failed.id, vehicleId)).rejects.toBeInstanceOf(
      DeliveryStateError,
    );

    const rows = await prisma.delivery.findMany({
      where: { id: { in: [delivered.id, failed.id] } },
      orderBy: { address: "asc" },
    });
    expect(rows.map((r) => r.status)).toEqual(["delivered", "failed"]);
  });

  it("still lets the dispatcher pull an en-route stop off its van", async () => {
    const d = await makeDelivery("en_route");

    await unassignDelivery(d.id);

    const after = await prisma.delivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(after.status).toBe("unassigned");
    expect(after.vehicleId).toBeNull();
    expect(after.sequence).toBeNull();
  });

  it("reports an unknown delivery as not found", async () => {
    await expect(unassignDelivery("no-such-delivery")).rejects.toBeInstanceOf(
      DeliveryNotFoundError,
    );
    await expect(assignDelivery("no-such-delivery", vehicleId)).rejects.toBeInstanceOf(
      DeliveryNotFoundError,
    );
  });
});
