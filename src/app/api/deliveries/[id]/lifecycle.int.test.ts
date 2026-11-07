import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { POST as assign } from "./assign/route";
import { POST as unassign } from "./unassign/route";

let vehicleId: string;
let deliveredId: string;
let openId: string;

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
  openId = (
    await prisma.delivery.create({
      data: { address: "Still in the pool", lat: 51.5, lng: -0.1 },
    })
  ).id;
});

afterAll(async () => {
  await prisma.dispatchEvent.deleteMany({ where: { deliveryId: openId } });
  await prisma.delivery.deleteMany({ where: { id: { in: [deliveredId, openId] } } });
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

describe("assign API with an unknown vehicle", () => {
  it("answers 404 naming the vehicle and leaves the stop unassigned", async () => {
    const res = await assign(post({ vehicleId: "no-such-vehicle" }), ctx(openId));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Vehicle no-such-vehicle not found");

    const after = await prisma.delivery.findUniqueOrThrow({ where: { id: openId } });
    expect(after.status).toBe("unassigned");
    expect(after.vehicleId).toBeNull();
  });
});
