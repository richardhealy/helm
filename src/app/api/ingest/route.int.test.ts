import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "./route";

let vehicleId: string;

beforeAll(async () => {
  const v = await prisma.vehicle.create({ data: { label: "route-test" } });
  vehicleId = v.id;
});

afterAll(async () => {
  await prisma.positionPing.deleteMany({ where: { vehicleId } });
  await prisma.vehicle.delete({ where: { id: vehicleId } });
  await prisma.$disconnect();
});

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/ingest", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("POST /api/ingest", () => {
  it("rejects an invalid body with 400", async () => {
    const res = await post({ vehicleId, lat: 999, lng: 0, heading: 0, speed: 0 });
    expect(res.status).toBe(400);
  });

  it("accepts a valid ping with 201", async () => {
    const res = await post({ vehicleId, lat: 51.5, lng: -0.1, heading: 45, speed: 5 });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBeTruthy();
  });
});
