import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import {
  createDelivery,
  listUnassigned,
  listForVehicle,
  assignDelivery,
} from "./deliveries";

let vehicleId: string;
const createdDeliveries: string[] = [];

beforeAll(async () => {
  const v = await prisma.vehicle.create({ data: { label: "deliv-test" } });
  vehicleId = v.id;
});

afterAll(async () => {
  await prisma.delivery.deleteMany({ where: { id: { in: createdDeliveries } } });
  await prisma.vehicle.delete({ where: { id: vehicleId } });
  await prisma.$disconnect();
});

describe("delivery intake + assignment", () => {
  it("creates a geocoded, unassigned delivery and assigns it", async () => {
    const d = await createDelivery({ address: "Piccadilly Circus, London" });
    createdDeliveries.push(d.id);

    expect(d.status).toBe("unassigned");
    expect(Math.abs(d.lat - 51.51)).toBeLessThan(0.1);

    const unassigned = await listUnassigned();
    expect(unassigned.some((x) => x.id === d.id)).toBe(true);

    await assignDelivery(d.id, vehicleId);
    const forVehicle = await listForVehicle(vehicleId);
    const found = forVehicle.find((x) => x.id === d.id);
    expect(found?.status).toBe("assigned");
    expect(found?.vehicleId).toBe(vehicleId);
  });
});
