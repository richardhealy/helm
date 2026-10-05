import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { POST as assign } from "./assign/route";
import { POST as unassign } from "./unassign/route";

let vehicleId: string;
let deliveredId: string;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body?: unknown) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  vehicleId = (await prisma.vehicle.create({ data: { label: "api-lifecycle" } })).id;
  deliveredId = (
    await prisma.delivery.create({
      data: {
        address: "Already delivered",
        lat: 51.5,
        lng: -0.1,
        status: "delivered",
        vehicleId,
        completedAt: new Date(),
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.delivery.deleteMany({ where: { id: deliveredId } });
  await prisma.vehicle.delete({ where: { id: vehicleId } });
  await prisma.$disconnect();
});

describe("assign / unassign API on a finished stop", () => {
  it("answers 409 when unassigning a delivered stop", async () => {
    const res = await unassign(post(), ctx(deliveredId));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/delivered/);
  });

  it("answers 409 when reassigning a delivered stop", async () => {
    const res = await assign(post({ vehicleId }), ctx(deliveredId));
    expect(res.status).toBe(409);
  });

  it("answers 404 for an unknown delivery", async () => {
    expect((await unassign(post(), ctx("no-such-delivery"))).status).toBe(404);
    expect((await assign(post({ vehicleId }), ctx("no-such-delivery"))).status).toBe(404);
  });
});
