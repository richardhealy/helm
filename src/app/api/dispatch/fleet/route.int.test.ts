import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "./route";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /api/dispatch/fleet", () => {
  it("returns 409 when there is nothing to dispatch", async () => {
    // ensure no unassigned deliveries exist for this assertion
    await prisma.delivery.updateMany({
      where: { status: "unassigned" },
      data: { status: "failed" },
    });
    const res = await POST();
    expect(res.status).toBe(409);
    // restore
    await prisma.delivery.updateMany({
      where: { status: "failed" },
      data: { status: "unassigned" },
    });
  });
});
