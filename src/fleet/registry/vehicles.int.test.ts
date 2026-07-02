import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { createDepot, createVehicle, listVehicles } from "./vehicles";

const created: string[] = [];

afterAll(async () => {
  await prisma.vehicle.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("fleet registry", () => {
  it("creates a vehicle and returns it in the summary list", async () => {
    const depot = await createDepot({ name: "Depot A", lat: 51.5, lng: -0.1 });
    const vehicle = await createVehicle({ label: "Van 7", depotId: depot.id });
    created.push(vehicle.id);

    const summaries = await listVehicles();
    const found = summaries.find((v) => v.id === vehicle.id);

    expect(found).toBeDefined();
    expect(found?.label).toBe("Van 7");
    expect(found?.status).toBe("idle");

    await prisma.depot.delete({ where: { id: depot.id } });
  });
});
