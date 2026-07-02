import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";

describe("delivery schema", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a delivery with default status", async () => {
    const d = await prisma.delivery.create({
      data: { address: "10 Downing St", lat: 51.5034, lng: -0.1276 },
    });
    expect(d.status).toBe("unassigned");
    await prisma.delivery.delete({ where: { id: d.id } });
  });
});
