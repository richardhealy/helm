import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";

describe("route progress", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("defaults progressMeters to 0", async () => {
    const v = await prisma.vehicle.create({ data: { label: "prog-test" } });
    const r = await prisma.route.create({
      data: { vehicleId: v.id, geometry: { type: "LineString", coordinates: [] }, distance: 0, duration: 0 },
    });
    expect(r.progressMeters).toBe(0);
    await prisma.route.delete({ where: { id: r.id } });
    await prisma.vehicle.delete({ where: { id: v.id } });
  });
});
