import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "./route";

const created: string[] = [];

afterAll(async () => {
  await prisma.delivery.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/deliveries", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("POST /api/deliveries", () => {
  it("rejects a missing address with 400", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
  });

  it("creates a geocoded delivery with 201", async () => {
    const res = await post({ address: "Oxford Circus, London" });
    expect(res.status).toBe(201);
    const json = await res.json();
    created.push(json.id);
    expect(json.status).toBe("unassigned");
  });
});
