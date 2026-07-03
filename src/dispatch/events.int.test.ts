import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { logEvent, listEvents } from "./events";

const ids: string[] = [];

afterAll(async () => {
  await prisma.dispatchEvent.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe("dispatch events", () => {
  it("logs an event and lists it back most-recent-first", async () => {
    await logEvent({ type: "optimized", actor: "dispatcher", detail: "3 stops" });
    const events = await listEvents(5);
    ids.push(...events.map((e) => e.id));
    expect(events[0].type).toBe("optimized");
    expect(events[0].actor).toBe("dispatcher");
    expect(events[0].detail).toBe("3 stops");
  });
});
