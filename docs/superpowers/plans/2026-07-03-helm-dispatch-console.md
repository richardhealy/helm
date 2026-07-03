# helm — Dispatch Console Implementation Plan (Plan 4 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dispatcher's console — an "ops terminal" panel docked over the live map where a human adds deliveries by address, assigns/reassigns stops to vehicles, runs optimization, and watches the board update live — replacing the demo scripts with a usable interface.

**Architecture:** A single board endpoint (`GET /api/dispatch`) returns the unassigned pool plus each vehicle with its ordered stops and ETAs. A client `DispatchPanel` renders that board in the ops-terminal style and calls thin command routes (`assign`, `unassign`, `optimize`, `create delivery`). The panel re-fetches the board whenever an SSE event (`vehicle_position` / `route_updated` / `stop_status`) arrives, so it stays in lockstep with the map and the simulator.

**Tech Stack:** Same as Plans 1–3 — Next 16 App Router (client components), Prisma 7, Vitest. No new dependencies; the ops-terminal look uses Tailwind v4 utilities + `ui-monospace` (no web-font download).

## Design system — "Ops terminal" (follow exactly)

Approved direction. Derive every colour/type decision from this.

- **Palette** (Tailwind arbitrary values / inline): console glass `#0b1220` at ~85% over the map; hairline `#1e293b`; ink `#e2e8f0`; dim `#64748b`. Status is meaningful: `delivered #22c55e`, `en_route #f59e0b`, `unassigned`/`idle #64748b`, `offline #475569`; signal (vehicle/route/active) `#38bdf8` — the same cyan as the map arrow + route line, so panel and map read as one system.
- **Type:** telemetry is monospace — `font-mono` (`ui-monospace`) for ETAs, coordinates, callsigns, and sequence badges. Micro-labels/eyebrows/section heads are `system-ui`, uppercase, tracked (`tracking-widest text-[10px] text-[#64748b]`).
- **Layout:** left-docked panel, `w-[380px]`, translucent, full height, scrolls internally; the map fills behind and stays the hero. Panel order: `DISPATCH` header + fleet status line → address intake → unassigned pool → vehicle roster.
- **Signature — the waybill ticket:** each delivery renders as a ticket with a status lamp (a small rounded dot in the status colour), a **mono sequence badge** when it has a place in an optimized route (a real sequence, so the number carries information), the address, and a right-aligned mono ETA. Vehicles are callsigns with a status lamp that pulses (`animate-pulse`) when `en_route`.
- **Restraint:** the ticket is the one bold element; everything else is quiet. Quality floor: visible keyboard focus on inputs/buttons, `prefers-reduced-motion` respected for the pulse, works when the board is empty (empty states invite action, e.g. "No unassigned deliveries. Add one above.").

---

## Global Constraints

Copied verbatim from `spec.md`; every task's requirements implicitly include these.

- **Dispatcher is the only surface;** single-tenant in v1. Commands go over normal request handlers; the panel observes via SSE.
- **Single-vehicle optimization** (Optimization v1) — the console assigns stops to one vehicle at a time and optimizes per vehicle.
- **The ingest boundary is untouched** — the console reads state and issues assign/optimize commands; it never produces `PositionPing`s.
- **Realtime transport:** SSE over Postgres `LISTEN/NOTIFY`.

**Repo state at start:** Plans 1–3 merged. Existing interfaces this plan consumes:
- `@/deliveries/orders/deliveries` → `createDelivery`, `listUnassigned`, `listForVehicle`, `assignDelivery`, `unassignDelivery`, `type DeliverySummary`
- `@/fleet/registry/vehicles` → `listVehicles`, `type VehicleSummary`
- `@/routing/routes/routes` → `getActiveRoute`, `optimizeRouteForVehicle`
- API routes: `POST /api/deliveries`, `POST /api/vehicles/[id]/optimize`, `GET /api/vehicles/[id]/route`, SSE `GET /api/stream`
- `src/app/(app)/dashboard/page.tsx` renders `FleetMap`

**Testing convention (unchanged):** `*.test.ts` = unit (no DB/network). `*.int.test.ts` = integration (needs Postgres). UI is gated by `npm run typecheck` + `npm run build`; visual behaviour is checked by the human in the browser. After `prisma migrate`, run `npm run db:generate`. `npm test` runs everything.

---

### Task 1: Dispatch board data

**Files:**
- Create: `src/dispatch/board.ts`
- Test: `src/dispatch/board.int.test.ts`

**Interfaces:**
- Consumes: `prisma`, `getActiveRoute` (Plan 2).
- Produces:
  - `type BoardStop = { id: string; address: string; status: string; sequence: number | null; eta: string | null }`
  - `type BoardVehicle = { id: string; label: string; status: string; stops: BoardStop[] }`
  - `type DispatchBoard = { unassigned: { id: string; address: string }[]; vehicles: BoardVehicle[] }`
  - `async function getDispatchBoard(): Promise<DispatchBoard>` — unassigned deliveries, plus every vehicle with its non-unassigned stops in `sequence` order, each carrying the ETA from its active route leg (ISO string) when one exists.

- [ ] **Step 1: Write the failing test**

Create `src/dispatch/board.int.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/dispatch/board.int.test.ts`
Expected: FAIL — cannot find module `./board`.

- [ ] **Step 3: Implement the board**

Create `src/dispatch/board.ts`:

```typescript
import { prisma } from "@/lib/db";
import { getActiveRoute } from "@/routing/routes/routes";

export type BoardStop = {
  id: string;
  address: string;
  status: string;
  sequence: number | null;
  eta: string | null;
};

export type BoardVehicle = {
  id: string;
  label: string;
  status: string;
  stops: BoardStop[];
};

export type DispatchBoard = {
  unassigned: { id: string; address: string }[];
  vehicles: BoardVehicle[];
};

export async function getDispatchBoard(): Promise<DispatchBoard> {
  const [unassignedRows, vehicles] = await Promise.all([
    prisma.delivery.findMany({
      where: { status: "unassigned" },
      orderBy: { createdAt: "asc" },
      select: { id: true, address: true },
    }),
    prisma.vehicle.findMany({ orderBy: { label: "asc" } }),
  ]);

  const boardVehicles: BoardVehicle[] = [];
  for (const v of vehicles) {
    const [stops, route] = await Promise.all([
      prisma.delivery.findMany({
        where: { vehicleId: v.id, status: { not: "unassigned" } },
        orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
      }),
      getActiveRoute(v.id),
    ]);
    const etaByDelivery = new Map(
      (route?.legs ?? []).map((l) => [l.toDeliveryId, l.eta.toISOString()]),
    );
    boardVehicles.push({
      id: v.id,
      label: v.label,
      status: v.status,
      stops: stops.map((s) => ({
        id: s.id,
        address: s.address,
        status: s.status,
        sequence: s.sequence,
        eta: etaByDelivery.get(s.id) ?? null,
      })),
    });
  }

  return {
    unassigned: unassignedRows.map((d) => ({ id: d.id, address: d.address })),
    vehicles: boardVehicles,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/dispatch/board.int.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/dispatch/board.ts src/dispatch/board.int.test.ts
git commit -m "feat(dispatch): board data (unassigned + vehicles with stops/ETAs)"
```

---

### Task 2: Board + command API routes

**Files:**
- Create: `src/app/api/dispatch/route.ts`
- Create: `src/app/api/deliveries/[id]/assign/route.ts`
- Create: `src/app/api/deliveries/[id]/unassign/route.ts`
- Test: `src/app/api/dispatch/route.int.test.ts`

**Interfaces:**
- Consumes: `getDispatchBoard` (Task 1), `assignDelivery`/`unassignDelivery` (Plan 2).
- Produces:
  - `GET /api/dispatch` → `DispatchBoard`.
  - `POST /api/deliveries/[id]/assign` — body `{ vehicleId }`; assigns; `200 { ok: true }`, `400` on missing `vehicleId`.
  - `POST /api/deliveries/[id]/unassign` — unassigns; `200 { ok: true }`.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/dispatch/route.int.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/api/dispatch/route.int.test.ts`
Expected: FAIL — cannot find module `./route`.

- [ ] **Step 3: Implement the board route**

Create `src/app/api/dispatch/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getDispatchBoard } from "@/dispatch/board";

export const dynamic = "force-dynamic";

export async function GET() {
  const board = await getDispatchBoard();
  return NextResponse.json(board);
}
```

- [ ] **Step 4: Implement the assign route**

Create `src/app/api/deliveries/[id]/assign/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { assignDelivery } from "@/deliveries/orders/deliveries";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { vehicleId } = (await request.json().catch(() => ({}))) as {
    vehicleId?: string;
  };
  if (!vehicleId) {
    return NextResponse.json({ error: "vehicleId is required" }, { status: 400 });
  }
  await assignDelivery(id, vehicleId);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Implement the unassign route**

Create `src/app/api/deliveries/[id]/unassign/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { unassignDelivery } from "@/deliveries/orders/deliveries";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await unassignDelivery(id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Run the board route test, then typecheck**

Run: `npx vitest run src/app/api/dispatch/route.int.test.ts` (expect 1 passed), then `npm run typecheck` (expect exit 0).

- [ ] **Step 7: Commit**

```bash
git add src/app/api/dispatch "src/app/api/deliveries/[id]"
git commit -m "feat(dispatch): board + assign/unassign API routes"
```

---

### Task 3: Ops-terminal formatters + panel shell

**Files:**
- Create: `src/dispatch/format.ts`
- Test: `src/dispatch/format.test.ts`
- Create: `src/console/dispatch/DispatchPanel.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx` (mount the panel over the map)

**Interfaces:**
- Consumes: `DispatchBoard` types (Task 1), `GET /api/dispatch`.
- Produces:
  - `src/dispatch/format.ts` (pure): `formatEta(iso: string | null): string` → `"14:32"` local time, or `"—"` when null; `fleetStatusLine(vehicles: { status: string }[]): string` → e.g. `"3 vehicles · 1 en route"`.
  - `DispatchPanel` (client) — fetches the board on mount, renders the header + fleet status line and an empty scaffold for the pool/roster (filled in Tasks 4–5). Docked left over the map.

- [ ] **Step 1: Write the failing unit test**

Create `src/dispatch/format.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatEta, fleetStatusLine } from "./format";

describe("formatEta", () => {
  it("returns a dash for null", () => {
    expect(formatEta(null)).toBe("—");
  });
  it("formats an ISO time as HH:MM", () => {
    // 09:05 UTC — assert the shape, not the tz-shifted value
    expect(formatEta("2026-07-03T09:05:00.000Z")).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("fleetStatusLine", () => {
  it("counts vehicles and those en route", () => {
    expect(
      fleetStatusLine([{ status: "idle" }, { status: "en_route" }, { status: "en_route" }]),
    ).toBe("3 vehicles · 2 en route");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/dispatch/format.test.ts`
Expected: FAIL — cannot find module `./format`.

- [ ] **Step 3: Implement the formatters**

Create `src/dispatch/format.ts`:

```typescript
export function formatEta(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function fleetStatusLine(vehicles: { status: string }[]): string {
  const enRoute = vehicles.filter((v) => v.status === "en_route").length;
  return `${vehicles.length} vehicle${vehicles.length === 1 ? "" : "s"} · ${enRoute} en route`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/dispatch/format.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Create the panel shell**

Create `src/console/dispatch/DispatchPanel.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import type { DispatchBoard } from "@/dispatch/board";
import { fleetStatusLine } from "@/dispatch/format";

const LABEL = "text-[10px] uppercase tracking-widest text-[#64748b]";

export function DispatchPanel() {
  const [board, setBoard] = useState<DispatchBoard | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/dispatch");
    if (res.ok) setBoard(await res.json());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <aside className="absolute inset-y-0 left-0 z-10 flex w-[380px] flex-col gap-4 overflow-y-auto border-r border-[#1e293b] bg-[#0b1220]/85 p-5 text-[#e2e8f0] backdrop-blur-md">
      <header>
        <h1 className="font-mono text-lg tracking-tight">DISPATCH</h1>
        <p className={LABEL}>
          {board ? fleetStatusLine(board.vehicles) : "connecting…"}
        </p>
      </header>
      {/* intake (Task 4), unassigned pool (Task 4), vehicle roster (Task 5) */}
    </aside>
  );
}
```

- [ ] **Step 6: Mount the panel over the map**

In `src/app/(app)/dashboard/page.tsx`, wrap the map and panel in a relative container. Update the import block and the `return`:

```tsx
import { DispatchPanel } from "@/console/dispatch/DispatchPanel";
```

```tsx
  const stops = await listRouteStops();
  return (
    <div className="relative h-screen w-full">
      <FleetMap vehicles={vehicles} routes={routes} stops={stops} />
      <DispatchPanel />
    </div>
  );
}
```

- [ ] **Step 7: Typecheck, build**

Run: `npm run typecheck && npm run build`
Expected: exit 0; "Compiled successfully".

- [ ] **Step 8: Commit**

```bash
git add src/dispatch/format.ts src/dispatch/format.test.ts src/console/dispatch/DispatchPanel.tsx "src/app/(app)/dashboard/page.tsx"
git commit -m "feat(console): ops-terminal panel shell + formatters"
```

---

### Task 4: Address intake + unassigned pool

**Files:**
- Modify: `src/console/dispatch/DispatchPanel.tsx`
- Create: `src/console/dispatch/WaybillTicket.tsx`

**Interfaces:**
- Consumes: `POST /api/deliveries`, the board's `unassigned` array.
- Produces: an address input that creates a delivery (biased to GB + London) and refreshes the board; the unassigned pool rendered as waybill tickets; `WaybillTicket` — the signature component: status lamp + optional mono sequence badge + address + mono ETA.

- [ ] **Step 1: Create the WaybillTicket component**

Create `src/console/dispatch/WaybillTicket.tsx`:

```tsx
const LAMP: Record<string, string> = {
  delivered: "#22c55e",
  en_route: "#f59e0b",
  assigned: "#64748b",
  unassigned: "#64748b",
  failed: "#ef4444",
};

export function WaybillTicket({
  address,
  status,
  sequence,
  eta,
  onAction,
  actionLabel,
}: {
  address: string;
  status: string;
  sequence?: number | null;
  eta?: string;
  onAction?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded border border-[#1e293b] bg-white/[0.02] px-3 py-2">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: LAMP[status] ?? "#64748b" }}
        aria-hidden
      />
      {sequence != null && (
        <span className="font-mono text-xs text-[#38bdf8]">
          {String(sequence + 1).padStart(2, "0")}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-sm">{address}</span>
      {eta && <span className="font-mono text-xs text-[#64748b]">{eta}</span>}
      {onAction && actionLabel && (
        <button
          onClick={onAction}
          className="rounded border border-[#1e293b] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[#94a3b8] hover:border-[#38bdf8] hover:text-[#38bdf8] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#38bdf8]"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add intake + pool to the panel**

In `src/console/dispatch/DispatchPanel.tsx`, add an `address` state and an intake form + pool section. Update the imports and body:

```tsx
import { useCallback, useEffect, useState } from "react";
import type { DispatchBoard } from "@/dispatch/board";
import { fleetStatusLine, formatEta } from "@/dispatch/format";
import { WaybillTicket } from "./WaybillTicket";
```

Add state and a create handler inside the component (after `refresh`):

```tsx
  const [address, setAddress] = useState("");

  const addDelivery = useCallback(async () => {
    if (!address.trim()) return;
    await fetch("/api/deliveries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address,
        bias: { country: "gb", proximity: { lat: 51.5, lng: -0.12 } },
      }),
    });
    setAddress("");
    refresh();
  }, [address, refresh]);
```

Add these sections inside the `<aside>`, after the `<header>`:

```tsx
      <section className="flex flex-col gap-2">
        <label className={LABEL} htmlFor="addr">Add delivery</label>
        <div className="flex gap-2">
          <input
            id="addr"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addDelivery()}
            placeholder="Address"
            className="min-w-0 flex-1 rounded border border-[#1e293b] bg-black/20 px-3 py-1.5 text-sm placeholder:text-[#475569] focus:border-[#38bdf8] focus:outline-none"
          />
          <button
            onClick={addDelivery}
            className="rounded bg-[#38bdf8] px-3 py-1.5 text-xs font-medium text-[#0b1220] hover:bg-[#7dd3fc] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38bdf8]"
          >
            Add
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <p className={LABEL}>Unassigned · {board?.unassigned.length ?? 0}</p>
        {board && board.unassigned.length === 0 ? (
          <p className="text-xs text-[#475569]">No unassigned deliveries. Add one above.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {board?.unassigned.map((d) => (
              <WaybillTicket key={d.id} address={d.address} status="unassigned" />
            ))}
          </div>
        )}
      </section>
```

- [ ] **Step 3: Typecheck, build**

Run: `npm run typecheck && npm run build`
Expected: exit 0.

- [ ] **Step 4: Visual check**

With the app running, open `/dashboard`. Type an address (e.g. "Covent Garden, London"), press Enter or Add.
Expected: it appears as a waybill ticket with a grey lamp in the Unassigned pool.

- [ ] **Step 5: Commit**

```bash
git add src/console/dispatch/WaybillTicket.tsx src/console/dispatch/DispatchPanel.tsx
git commit -m "feat(console): address intake + unassigned pool"
```

---

### Task 5: Vehicle roster with stops, ETAs, and optimize

**Files:**
- Modify: `src/console/dispatch/DispatchPanel.tsx`

**Interfaces:**
- Consumes: `POST /api/vehicles/[id]/optimize`, the board's `vehicles` array.
- Produces: a vehicle roster — each vehicle a callsign with a status lamp (pulsing when `en_route`), its ordered stops as waybill tickets (mono sequence badge + ETA), and an Optimize action.

- [ ] **Step 1: Add the roster to the panel**

In `src/console/dispatch/DispatchPanel.tsx`, add an optimize handler (after `addDelivery`):

```tsx
  const optimize = useCallback(
    async (vehicleId: string) => {
      await fetch(`/api/vehicles/${vehicleId}/optimize`, { method: "POST" });
      refresh();
    },
    [refresh],
  );
```

Add the roster section at the end of the `<aside>`:

```tsx
      <section className="flex flex-col gap-3">
        <p className={LABEL}>Fleet</p>
        {board?.vehicles.map((v) => (
          <div key={v.id} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${v.status === "en_route" ? "motion-safe:animate-pulse" : ""}`}
                style={{ backgroundColor: v.status === "en_route" ? "#f59e0b" : v.status === "offline" ? "#475569" : "#64748b" }}
                aria-hidden
              />
              <span className="flex-1 font-mono text-sm">{v.label}</span>
              <span className={LABEL}>{v.stops.length} stops</span>
              <button
                onClick={() => optimize(v.id)}
                className="rounded border border-[#1e293b] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[#94a3b8] hover:border-[#38bdf8] hover:text-[#38bdf8] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#38bdf8]"
              >
                Optimize
              </button>
            </div>
            <div className="flex flex-col gap-1 pl-4">
              {v.stops.length === 0 ? (
                <p className="text-xs text-[#475569]">No stops assigned.</p>
              ) : (
                v.stops.map((s) => (
                  <WaybillTicket
                    key={s.id}
                    address={s.address}
                    status={s.status}
                    sequence={s.sequence}
                    eta={formatEta(s.eta)}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </section>
```

- [ ] **Step 2: Typecheck, build**

Run: `npm run typecheck && npm run build`
Expected: exit 0.

- [ ] **Step 3: Visual check**

Open `/dashboard`. Each vehicle shows a callsign + lamp + stop count + Optimize. Assign a stop (next task) or reuse existing data; the stops list shows mono sequence badges + ETAs.

- [ ] **Step 4: Commit**

```bash
git add src/console/dispatch/DispatchPanel.tsx
git commit -m "feat(console): vehicle roster with stops, ETAs, optimize"
```

---

### Task 6: Assign unassigned stops to a vehicle

**Files:**
- Modify: `src/console/dispatch/DispatchPanel.tsx`

**Interfaces:**
- Consumes: `POST /api/deliveries/[id]/assign`, `POST /api/deliveries/[id]/unassign`.
- Produces: each unassigned ticket gets an "Assign" action that assigns it to the currently-selected vehicle; each assigned stop gets an "Unassign" action. A vehicle selector drives which vehicle assignments target.

- [ ] **Step 1: Add selection + assign/unassign handlers**

In `src/console/dispatch/DispatchPanel.tsx`, add state + handlers (after `optimize`):

```tsx
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);

  const assign = useCallback(
    async (deliveryId: string, vehicleId: string) => {
      await fetch(`/api/deliveries/${deliveryId}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vehicleId }),
      });
      refresh();
    },
    [refresh],
  );

  const unassign = useCallback(
    async (deliveryId: string) => {
      await fetch(`/api/deliveries/${deliveryId}/unassign`, { method: "POST" });
      refresh();
    },
    [refresh],
  );
```

Keep `selectedVehicle` pointed at a real vehicle whenever possible — add this effect after the mount `useEffect`:

```tsx
  useEffect(() => {
    if (!selectedVehicle && board && board.vehicles.length > 0) {
      setSelectedVehicle(board.vehicles[0].id);
    }
  }, [board, selectedVehicle]);
```

- [ ] **Step 2: Wire the unassigned tickets' Assign action**

Replace the unassigned pool's `<WaybillTicket ... />` mapping with an assign-enabled version:

```tsx
            {board?.unassigned.map((d) => (
              <WaybillTicket
                key={d.id}
                address={d.address}
                status="unassigned"
                actionLabel={selectedVehicle ? "Assign" : undefined}
                onAction={
                  selectedVehicle ? () => assign(d.id, selectedVehicle) : undefined
                }
              />
            ))}
```

- [ ] **Step 3: Make vehicle rows selectable and add Unassign to stops**

In the roster, make the callsign a select control and add Unassign to each stop. Replace the vehicle-row `<span ...>{v.label}</span>` with a selectable button:

```tsx
              <button
                onClick={() => setSelectedVehicle(v.id)}
                className={`flex-1 text-left font-mono text-sm ${selectedVehicle === v.id ? "text-[#38bdf8]" : "text-[#e2e8f0]"}`}
              >
                {v.label}
                {selectedVehicle === v.id && <span className="ml-2 text-[10px] uppercase tracking-wider text-[#38bdf8]">target</span>}
              </button>
```

And give each stop ticket an Unassign action:

```tsx
                  <WaybillTicket
                    key={s.id}
                    address={s.address}
                    status={s.status}
                    sequence={s.sequence}
                    eta={formatEta(s.eta)}
                    actionLabel="Unassign"
                    onAction={() => unassign(s.id)}
                  />
```

- [ ] **Step 4: Typecheck, build**

Run: `npm run typecheck && npm run build`
Expected: exit 0.

- [ ] **Step 5: Visual check**

Open `/dashboard`. Click a vehicle to make it the target (turns cyan, shows "target"). Click Assign on an unassigned ticket — it moves under that vehicle. Click Optimize — stops reorder with sequence badges + ETAs and the route draws on the map. Click Unassign — the stop returns to the pool.

- [ ] **Step 6: Commit**

```bash
git add src/console/dispatch/DispatchPanel.tsx
git commit -m "feat(console): assign/reassign stops to a target vehicle"
```

---

### Task 7: Live board updates + end-to-end verification

**Files:**
- Modify: `src/console/dispatch/DispatchPanel.tsx`

**Interfaces:**
- Consumes: SSE `GET /api/stream` (`vehicle_position`, `route_updated`, `stop_status`).
- Produces: the panel re-fetches the board when a `route_updated` or `stop_status` event arrives, so tickets flip to `delivered` and ETAs update live alongside the map.

- [ ] **Step 1: Subscribe to SSE and refresh on relevant events**

In `src/console/dispatch/DispatchPanel.tsx`, add an effect after the mount effect. Refresh on route/stop changes (not on every position ping — those fire ~1/s and would hammer the board):

```tsx
  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.addEventListener("route_updated", () => refresh());
    es.addEventListener("stop_status", () => refresh());
    return () => es.close();
  }, [refresh]);
```

- [ ] **Step 2: Typecheck, build**

Run: `npm run typecheck && npm run build`
Expected: exit 0.

- [ ] **Step 3: End-to-end visual check**

With Postgres up and the app running, from a clean board:
1. Add 3–4 deliveries by address in the panel.
2. Click a vehicle (target), Assign each one.
3. Click Optimize — stops get sequence badges + ETAs, the route line draws on the map.
4. Run the simulator: `npx tsx scripts/simulator.ts`.
Expected: the vehicle glides the route on the map **and** each stop's ticket lamp flips grey/amber → green with the fleet status line updating — no manual refresh.

- [ ] **Step 4: Run the full suite and commit**

```bash
npm test
git add src/console/dispatch/DispatchPanel.tsx
git commit -m "feat(console): live board updates over SSE"
```
Expected: all tests pass.

---

## What Plan 4 delivers

A usable dispatch console: add deliveries by address, assign/reassign to vehicles, optimize, and watch the board and map update live as the simulator runs — the demo scripts are no longer required to operate helm. **Deferred to Plan 5 (final):** `DispatchEvent` audit trail, SSE reconnect hardening, a seed dataset, CI Postgres so integration tests run on push, and release.

## Self-review notes

- **Spec coverage (M6):** assign/optimize/reassign UX → Tasks 5–6; live re-optimization → Tasks 5–7; inspect (vehicle → ordered stops + ETAs) → Task 5; delivery intake surfaced in the console → Task 4. The board endpoint + command routes (Tasks 1–2) back it all.
- **Design system applied:** the waybill ticket is the single signature; monospace telemetry + status lamps throughout; the cyan signal matches the map; empty states invite action; focus-visible on inputs/buttons; the en_route pulse is `motion-safe`. ✔
- **Contract boundary:** the console reads via `/api/dispatch` and issues assign/optimize/unassign commands; it emits no `PositionPing`. ✔
- **Type consistency:** `DispatchBoard`/`BoardVehicle`/`BoardStop` (Task 1) are consumed by `/api/dispatch` (Task 2) and `DispatchPanel` (Tasks 3–7); `formatEta`/`fleetStatusLine` (Task 3) used in the panel; `WaybillTicket` props (Task 4) match every call site in Tasks 4–6; dynamic-route `params` awaited (Next 16). ✔
- **Known follow-up:** the panel re-fetches the whole board on each route/stop event — fine for one dispatcher and a handful of vehicles; a targeted patch is a scale item. Assignment targets one selected vehicle (no drag-drop) — a deliberate v1 simplification.
```
