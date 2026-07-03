import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getDispatchBoard } from "./board";

let vehicleId: string;
const deliveryIds: string[] = [];

beforeAll(async () => {
  const v = await prisma.vehicle.create({ data: { label: "board-test" } });
  vehicleId = v.id;
  const assigned = await prisma.delivery.create({
    data: { address: "Assigned St", lat: 51.5, lng: -0.1, status: "assigned", vehicleId, sequence: 0 },
  });
  const free = await prisma.delivery.create({
    data: { address: "Free St", lat: 51.5, lng: -0.1, status: "unassigned" },
  });
  deliveryIds.push(assigned.id, free.id);
});

afterAll(async () => {
  await prisma.delivery.deleteMany({ where: { id: { in: deliveryIds } } });
  await prisma.vehicle.delete({ where: { id: vehicleId } });
  await prisma.$disconnect();
});

describe("getDispatchBoard", () => {
  it("returns the unassigned pool and vehicles with their stops", async () => {
    const board = await getDispatchBoard();

    expect(board.unassigned.some((d) => d.address === "Free St")).toBe(true);

    const vehicle = board.vehicles.find((v) => v.id === vehicleId);
    expect(vehicle).toBeDefined();
    expect(vehicle!.stops).toHaveLength(1);
    expect(vehicle!.stops[0].address).toBe("Assigned St");
    expect(vehicle!.stops[0].sequence).toBe(0);
  });
});
