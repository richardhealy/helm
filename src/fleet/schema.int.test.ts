import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";

describe("fleet schema", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a depot, a vehicle, and a ping", async () => {
    const depot = await prisma.depot.create({
      data: { name: "Test Depot", lat: 51.5, lng: -0.12 },
    });
    const vehicle = await prisma.vehicle.create({
      data: { label: "V1", depotId: depot.id },
    });
    const ping = await prisma.positionPing.create({
      data: { vehicleId: vehicle.id, lat: 51.5, lng: -0.12, heading: 90, speed: 8 },
    });

    expect(vehicle.status).toBe("idle");
    expect(ping.source).toBe("simulation");

    await prisma.positionPing.deleteMany({ where: { vehicleId: vehicle.id } });
    await prisma.vehicle.delete({ where: { id: vehicle.id } });
    await prisma.depot.delete({ where: { id: depot.id } });
  });
});
