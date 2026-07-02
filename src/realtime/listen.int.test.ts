import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { subscribe } from "./listen";
import { ingestPing } from "@/fleet/ingest/ingest";

let vehicleId: string;

beforeAll(async () => {
  const v = await prisma.vehicle.create({ data: { label: "listen-test" } });
  vehicleId = v.id;
});

afterAll(async () => {
  await prisma.positionPing.deleteMany({ where: { vehicleId } });
  await prisma.vehicle.delete({ where: { id: vehicleId } });
  await prisma.$disconnect();
});

describe("subscribe", () => {
  it("receives a NOTIFY payload emitted by ingestPing", async () => {
    const received: string[] = [];
    const unsubscribe = await subscribe("vehicle_position", (p) => received.push(p));

    // Give LISTEN a moment to register, then trigger a NOTIFY.
    await new Promise((r) => setTimeout(r, 100));
    await ingestPing({ vehicleId, lat: 51.5, lng: -0.1, heading: 12, speed: 3 });
    await new Promise((r) => setTimeout(r, 200));

    await unsubscribe();

    // Other integration test files emit on the same channel in parallel, so
    // assert our own vehicle's payload is among those received — not that it is
    // necessarily first.
    const mine = received
      .map((p) => JSON.parse(p) as { vehicleId: string })
      .filter((p) => p.vehicleId === vehicleId);
    expect(mine.length).toBeGreaterThanOrEqual(1);
  });
});
