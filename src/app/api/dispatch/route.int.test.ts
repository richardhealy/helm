import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { GET } from "./route";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/dispatch", () => {
  it("returns a board with unassigned and vehicles arrays", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const board = await res.json();
    expect(Array.isArray(board.unassigned)).toBe(true);
    expect(Array.isArray(board.vehicles)).toBe(true);
  });
});
