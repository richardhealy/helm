import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { logEvent, listEvents } from "./events";

const MARKER = "events-unit-marker-3-stops";
const ids: string[] = [];

afterAll(async () => {
  await prisma.dispatchEvent.deleteMany({ where: { detail: MARKER } });
  await prisma.$disconnect();
});

describe("dispatch events", () => {
  it("logs an event and lists it back", async () => {
    await logEvent({ type: "optimized", actor: "dispatcher", detail: MARKER });

    // Other integration files log DispatchEvents in parallel, so find our own
    // event by its marker rather than assuming it is the most recent.
    const events = await listEvents(50);
    const mine = events.find((e) => e.detail === MARKER);
    ids.push(...events.map((e) => e.id));

    expect(mine).toBeDefined();
    expect(mine!.type).toBe("optimized");
    expect(mine!.actor).toBe("dispatcher");
  });
});
