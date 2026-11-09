import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { VehicleNotFoundError } from "@/fleet/registry/vehicles";
import { ingestPing } from "./ingest";

let vehicleId: string;

beforeAll(async () => {
  const v = await prisma.vehicle.create({ data: { label: "ingest-test" } });
  vehicleId = v.id;
});

afterAll(async () => {
  await prisma.positionPing.deleteMany({ where: { vehicleId } });
  await prisma.vehicle.delete({ where: { id: vehicleId } });
  await prisma.$disconnect();
});

describe("ingestPing", () => {
  it("writes a ping and projects the vehicle's current position", async () => {
    await ingestPing({
      vehicleId,
      lat: 51.51,
      lng: -0.13,
      heading: 180,
      speed: 10,
      source: "simulation",
    });

    const pings = await prisma.positionPing.findMany({ where: { vehicleId } });
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });

    expect(pings).toHaveLength(1);
    expect(vehicle.lat).toBeCloseTo(51.51);
    expect(vehicle.heading).toBe(180);
    expect(vehicle.positionUpdatedAt).not.toBeNull();
  });

  it("refuses a ping for a vehicle id that matches no vehicle and stores nothing", async () => {
    const missingId = "no-such-vehicle-ingest-test";
    const err = await ingestPing({
      vehicleId: missingId,
      lat: 51.5,
      lng: -0.1,
      heading: 90,
      speed: 4,
      source: "telematics",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(VehicleNotFoundError);
    expect((err as Error).message).toBe(`Vehicle ${missingId} not found`);
    expect(await prisma.positionPing.count({ where: { vehicleId: missingId } })).toBe(0);
  });
});
