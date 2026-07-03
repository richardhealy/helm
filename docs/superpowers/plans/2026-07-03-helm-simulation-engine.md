# helm — Simulation Engine Implementation Plan (Plan 3 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the persistent simulation engine that advances each vehicle smoothly along its optimized route geometry, emits normalized position pings through the existing ingest contract, flips stops to `delivered` on arrival, completes the route, and shows stop markers coloured by status on the map.

**Architecture:** A pure geo/step core (`haversine`, `bearing`, `pointAlongLine`, `simulateStep`) computes the next position and any arrivals from a route's geometry, a progress-in-metres cursor, and the cumulative distance to each stop. A thin DB-driven driver applies each tick: it writes a `PositionPing` via the **existing `ingestPing`** (so the map updates over the existing SSE path — the simulator is just another producer on the `PositionPing` contract), marks arrived deliveries `delivered` (emitting `stop_status`), completes the route, and persists progress. A standalone worker process runs the tick loop.

**Tech Stack:** Same as Plans 1–2 — Next 16, Prisma 7, Vitest, `tsx` for the worker. No new dependencies (great-circle math is hand-rolled and unit-tested).

## Global Constraints

Copied verbatim from `spec.md`; every task's requirements implicitly include these.

- **The simulator is a pure producer on the `PositionPing` contract.** It writes pings through `ingestPing` with `source: "simulation"` and shares no code with the map or routing UI. Swapping it for a telematics adapter must require no change above `src/fleet/ingest`.
- **The engine is a pure consumer of persisted `Route` geometry.** It reads geometry + legs; it does not call Mapbox.
- **Arrival flips a stop `en_route → delivered` exactly once, timestamped**, and the route completes only after its last stop.
- **Configurable** speed, tick rate, and arrival handling.
- **Realtime transport:** SSE over Postgres `LISTEN/NOTIFY`. The simulator emits `vehicle_position` (via ingest) and `stop_status`; the dispatcher observes.
- **Deploy target:** Railway hosts the persistent worker (a long-running tick loop rules out a purely serverless target).

**Repo state at start:** Plans 1–2 merged to `main`. Existing interfaces this plan consumes:
- `@/lib/db` → `prisma`
- `@/fleet/ingest/ingest` → `ingestPing(input: PositionPingInput): Promise<{ id: string }>` (writes ping, projects position, `NOTIFY vehicle_position`)
- `@/routing/routes/routes` → `getActiveRoute`, `optimizeRouteForVehicle`
- `Route` model has `geometry Json` (a GeoJSON LineString), `distance`, ordered `RouteLeg`s with `distance`/`toDeliveryId`
- `Delivery` model with `status` (`assigned`/`en_route`/`delivered`), `sequence`
- SSE route `src/app/api/stream/route.ts` relays `["vehicle_position", "route_updated"]`
- `src/console/map/FleetMap.tsx` (vehicle arrows + route lines), `markers.ts`, `routes.ts`
- Demo scripts use `scripts/load-env.ts` (side-effect env loader imported first)

**Testing convention (unchanged):** `*.test.ts` = unit (no DB/network). `*.int.test.ts` = integration (needs Postgres). After `prisma migrate`, run `npm run db:generate`. `npm test` runs everything.

---

### Task 1: Add route progress to the schema

**Files:**
- Modify: `prisma/schema.prisma` (add `progressMeters` to `Route`)

**Interfaces:**
- Consumes: existing `Route` model.
- Produces: `Route.progressMeters Float @default(0)` — how far along its geometry the vehicle has driven.

- [ ] **Step 1: Add the field**

In `prisma/schema.prisma`, add to the `Route` model (next to `duration`):

```prisma
  progressMeters Float @default(0)
```

- [ ] **Step 2: Migrate and regenerate**

Run:
```bash
npm run db:migrate -- --name route_progress
npm run db:generate
```
Expected: migration applied; client regenerated.

- [ ] **Step 3: Verify the field exists**

Create `src/simulation/schema.int.test.ts`:

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";

describe("route progress", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("defaults progressMeters to 0", async () => {
    const v = await prisma.vehicle.create({ data: { label: "prog-test" } });
    const r = await prisma.route.create({
      data: { vehicleId: v.id, geometry: { type: "LineString", coordinates: [] }, distance: 0, duration: 0 },
    });
    expect(r.progressMeters).toBe(0);
    await prisma.route.delete({ where: { id: r.id } });
    await prisma.vehicle.delete({ where: { id: v.id } });
  });
});
```

- [ ] **Step 4: Run it**

Run: `npx vitest run src/simulation/schema.int.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/simulation/schema.int.test.ts
git commit -m "feat(sim): add Route.progressMeters"
```

---

### Task 2: Great-circle geo helpers

**Files:**
- Create: `src/simulation/engine/geo.ts`
- Test: `src/simulation/engine/geo.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type LatLng = { lat: number; lng: number }`
  - `function haversine(a: LatLng, b: LatLng): number` — metres between two points.
  - `function bearing(a: LatLng, b: LatLng): number` — initial bearing, degrees clockwise from north, 0–360.
  - `function pointAlongLine(coords: [number, number][], distanceMeters: number): { lat: number; lng: number; heading: number }` — walk a GeoJSON `[lng, lat]` LineString `distanceMeters` from the start; returns the interpolated point and the heading of the segment it lands on. Clamps to the endpoints.

- [ ] **Step 1: Write the failing test**

Create `src/simulation/engine/geo.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { haversine, bearing, pointAlongLine } from "./geo";

describe("haversine", () => {
  it("measures ~111.2 km per degree of latitude", () => {
    const d = haversine({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe("bearing", () => {
  it("is ~90° due east", () => {
    expect(bearing({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90, 0);
  });
  it("is ~0° due north", () => {
    expect(bearing({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(0, 0);
  });
});

describe("pointAlongLine", () => {
  // A ~111km eastward segment then a ~111km northward segment from (0,0).
  const coords: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
  ];

  it("returns the start at distance 0", () => {
    const p = pointAlongLine(coords, 0);
    expect(p.lat).toBeCloseTo(0, 5);
    expect(p.lng).toBeCloseTo(0, 5);
  });

  it("lands partway along the first (eastbound) segment", () => {
    const half = haversine({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) / 2;
    const p = pointAlongLine(coords, half);
    expect(p.lng).toBeCloseTo(0.5, 1);
    expect(p.lat).toBeCloseTo(0, 5);
    expect(p.heading).toBeCloseTo(90, 0);
  });

  it("clamps to the last point when distance exceeds the line", () => {
    const p = pointAlongLine(coords, 10_000_000);
    expect(p.lat).toBeCloseTo(1, 5);
    expect(p.lng).toBeCloseTo(1, 5);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/simulation/engine/geo.test.ts`
Expected: FAIL — cannot find module `./geo`.

- [ ] **Step 3: Implement the geo helpers**

Create `src/simulation/engine/geo.ts`:

```typescript
export type LatLng = { lat: number; lng: number };

const R = 6_371_000; // Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversine(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearing(a: LatLng, b: LatLng): number {
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const dLng = rad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function pointAlongLine(
  coords: [number, number][],
  distanceMeters: number,
): { lat: number; lng: number; heading: number } {
  if (coords.length === 0) throw new Error("empty line");
  const pts: LatLng[] = coords.map(([lng, lat]) => ({ lat, lng }));
  if (coords.length === 1 || distanceMeters <= 0) {
    const next = pts[1] ?? pts[0];
    return { ...pts[0], heading: bearing(pts[0], next) };
  }

  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const segLen = haversine(pts[i], pts[i + 1]);
    if (acc + segLen >= distanceMeters) {
      const t = segLen === 0 ? 0 : (distanceMeters - acc) / segLen;
      return {
        lat: pts[i].lat + t * (pts[i + 1].lat - pts[i].lat),
        lng: pts[i].lng + t * (pts[i + 1].lng - pts[i].lng),
        heading: bearing(pts[i], pts[i + 1]),
      };
    }
    acc += segLen;
  }
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  return { ...last, heading: bearing(prev, last) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/simulation/engine/geo.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/engine/geo.ts src/simulation/engine/geo.test.ts
git commit -m "feat(sim): great-circle geo helpers"
```

---

### Task 3: The pure simulation step

**Files:**
- Create: `src/simulation/engine/step.ts`
- Test: `src/simulation/engine/step.test.ts`

**Interfaces:**
- Consumes: `pointAlongLine` (Task 2).
- Produces:
  - `type Stop = { deliveryId: string; distanceAlong: number }` — cumulative metres to each stop, in visiting order.
  - `type StepInput = { coords: [number, number][]; progressMeters: number; totalMeters: number; stops: Stop[]; speedMps: number; dtSeconds: number }`
  - `type StepResult = { newProgressMeters: number; position: { lat: number; lng: number; heading: number }; arrivedDeliveryIds: string[]; completed: boolean }`
  - `function simulateStep(input: StepInput): StepResult` — advances progress by `speedMps * dtSeconds` (clamped to `totalMeters`), returns the new position, the deliveries whose `distanceAlong` was crossed this tick, and whether the route is finished.

- [ ] **Step 1: Write the failing test**

Create `src/simulation/engine/step.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { simulateStep } from "./step";

// A straight ~111km eastbound line from (0,0) to (0,1) (~111,320 m).
const coords: [number, number][] = [
  [0, 0],
  [1, 0],
];
const total = 111_320;

describe("simulateStep", () => {
  it("advances progress by speed*dt and does not arrive early", () => {
    const r = simulateStep({
      coords,
      progressMeters: 0,
      totalMeters: total,
      stops: [{ deliveryId: "d1", distanceAlong: total }],
      speedMps: 100,
      dtSeconds: 1,
    });
    expect(r.newProgressMeters).toBeCloseTo(100, 0);
    expect(r.arrivedDeliveryIds).toEqual([]);
    expect(r.completed).toBe(false);
  });

  it("marks a stop arrived when its distance is crossed", () => {
    const r = simulateStep({
      coords,
      progressMeters: 400,
      totalMeters: total,
      stops: [{ deliveryId: "d1", distanceAlong: 500 }],
      speedMps: 200,
      dtSeconds: 1,
    });
    expect(r.newProgressMeters).toBeCloseTo(600, 0);
    expect(r.arrivedDeliveryIds).toEqual(["d1"]);
  });

  it("clamps at the end and reports completed", () => {
    const r = simulateStep({
      coords,
      progressMeters: total - 50,
      totalMeters: total,
      stops: [{ deliveryId: "d1", distanceAlong: total }],
      speedMps: 1000,
      dtSeconds: 1,
    });
    expect(r.newProgressMeters).toBe(total);
    expect(r.completed).toBe(true);
    expect(r.arrivedDeliveryIds).toEqual(["d1"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/simulation/engine/step.test.ts`
Expected: FAIL — cannot find module `./step`.

- [ ] **Step 3: Implement the step**

Create `src/simulation/engine/step.ts`:

```typescript
import { pointAlongLine } from "./geo";

export type Stop = { deliveryId: string; distanceAlong: number };

export type StepInput = {
  coords: [number, number][];
  progressMeters: number;
  totalMeters: number;
  stops: Stop[];
  speedMps: number;
  dtSeconds: number;
};

export type StepResult = {
  newProgressMeters: number;
  position: { lat: number; lng: number; heading: number };
  arrivedDeliveryIds: string[];
  completed: boolean;
};

export function simulateStep(input: StepInput): StepResult {
  const advanced = input.progressMeters + input.speedMps * input.dtSeconds;
  const newProgressMeters = Math.min(advanced, input.totalMeters);

  const arrivedDeliveryIds = input.stops
    .filter(
      (s) =>
        s.distanceAlong > input.progressMeters &&
        s.distanceAlong <= newProgressMeters,
    )
    .map((s) => s.deliveryId);

  return {
    newProgressMeters,
    position: pointAlongLine(input.coords, newProgressMeters),
    arrivedDeliveryIds,
    completed: newProgressMeters >= input.totalMeters,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/simulation/engine/step.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/engine/step.ts src/simulation/engine/step.test.ts
git commit -m "feat(sim): pure simulate-step core"
```

---

### Task 4: Stop-distance helper from route legs

**Files:**
- Create: `src/simulation/engine/stops.ts`
- Test: `src/simulation/engine/stops.test.ts`

**Interfaces:**
- Consumes: `Stop` type (Task 3).
- Produces:
  - `function cumulativeStops(legs: { distance: number; toDeliveryId: string | null }[]): Stop[]` — turns ordered legs into cumulative-distance stops, skipping legs whose `toDeliveryId` is null (e.g. a return-to-depot leg).

- [ ] **Step 1: Write the failing test**

Create `src/simulation/engine/stops.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { cumulativeStops } from "./stops";

describe("cumulativeStops", () => {
  it("accumulates leg distances into per-stop distances", () => {
    const stops = cumulativeStops([
      { distance: 1000, toDeliveryId: "a" },
      { distance: 2000, toDeliveryId: "b" },
      { distance: 500, toDeliveryId: null }, // return to depot — skipped
    ]);
    expect(stops).toEqual([
      { deliveryId: "a", distanceAlong: 1000 },
      { deliveryId: "b", distanceAlong: 3000 },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/simulation/engine/stops.test.ts`
Expected: FAIL — cannot find module `./stops`.

- [ ] **Step 3: Implement**

Create `src/simulation/engine/stops.ts`:

```typescript
import type { Stop } from "./step";

export function cumulativeStops(
  legs: { distance: number; toDeliveryId: string | null }[],
): Stop[] {
  const stops: Stop[] = [];
  let acc = 0;
  for (const leg of legs) {
    acc += leg.distance;
    if (leg.toDeliveryId) {
      stops.push({ deliveryId: leg.toDeliveryId, distanceAlong: acc });
    }
  }
  return stops;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/simulation/engine/stops.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/engine/stops.ts src/simulation/engine/stops.test.ts
git commit -m "feat(sim): cumulative stop distances from legs"
```

---

### Task 5: The tick driver (applies a step to the database)

**Files:**
- Create: `src/simulation/driver.ts`
- Test: `src/simulation/driver.int.test.ts`

**Interfaces:**
- Consumes: `prisma`, `ingestPing` (Plan 1), `simulateStep`/`Stop` (Task 3), `cumulativeStops` (Task 4).
- Produces:
  - `async function tickVehicle(vehicleId: string, opts: { speedMps: number; dtSeconds: number }): Promise<{ moved: boolean; arrived: string[]; completed: boolean }>` — loads the vehicle's active route + legs, advances one step, writes a `PositionPing` via `ingestPing` (`source: "simulation"`), on first movement flips the vehicle to `en_route` and its `assigned` deliveries to `en_route`, marks arrived deliveries `delivered` (`completedAt` set, `NOTIFY stop_status`), persists `progressMeters`, and on completion marks the route `completed` and the vehicle `idle`. Returns `{ moved: false, ... }` when there is no active route.
  - `async function tickAll(opts: { speedMps: number; dtSeconds: number }): Promise<void>` — runs `tickVehicle` for every vehicle with an `active` route.

- [ ] **Step 1: Write the failing test**

Create `src/simulation/driver.int.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { tickVehicle } from "./driver";

let vehicleId: string;
let deliveryId: string;
let routeId: string;

beforeAll(async () => {
  const v = await prisma.vehicle.create({ data: { label: "sim-test" } });
  vehicleId = v.id;
  const d = await prisma.delivery.create({
    data: { address: "Dest", lat: 0, lng: 1, status: "assigned", vehicleId, sequence: 0 },
  });
  deliveryId = d.id;
  // straight ~111km eastbound line; one stop at the end
  const route = await prisma.route.create({
    data: {
      vehicleId,
      status: "active",
      geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
      distance: 111_320,
      duration: 3600,
      progressMeters: 0,
    },
  });
  routeId = route.id;
  await prisma.routeLeg.create({
    data: { routeId, sequence: 0, distance: 111_320, duration: 3600, eta: new Date(), toDeliveryId: deliveryId },
  });
});

afterAll(async () => {
  await prisma.routeLeg.deleteMany({ where: { routeId } });
  await prisma.route.deleteMany({ where: { vehicleId } });
  await prisma.positionPing.deleteMany({ where: { vehicleId } });
  await prisma.delivery.deleteMany({ where: { id: deliveryId } });
  await prisma.vehicle.delete({ where: { id: vehicleId } });
  await prisma.$disconnect();
});

describe("tickVehicle", () => {
  it("moves the vehicle and sets it en_route on the first tick", async () => {
    const r = await tickVehicle(vehicleId, { speedMps: 100, dtSeconds: 1 });
    expect(r.moved).toBe(true);
    expect(r.completed).toBe(false);

    const v = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    expect(v.status).toBe("en_route");
    expect(v.lng).toBeGreaterThan(0); // advanced eastward
    const pings = await prisma.positionPing.count({ where: { vehicleId } });
    expect(pings).toBe(1);
  });

  it("delivers the stop and completes the route when it reaches the end", async () => {
    // one giant tick to force arrival + completion
    const r = await tickVehicle(vehicleId, { speedMps: 1_000_000, dtSeconds: 1 });
    expect(r.arrived).toContain(deliveryId);
    expect(r.completed).toBe(true);

    const d = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(d.status).toBe("delivered");
    expect(d.completedAt).not.toBeNull();

    const route = await prisma.route.findUniqueOrThrow({ where: { id: routeId } });
    expect(route.status).toBe("completed");
    const v = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    expect(v.status).toBe("idle");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/simulation/driver.int.test.ts`
Expected: FAIL — cannot find module `./driver`.

- [ ] **Step 3: Implement the driver**

Create `src/simulation/driver.ts`:

```typescript
import { prisma } from "@/lib/db";
import { ingestPing } from "@/fleet/ingest/ingest";
import { simulateStep } from "./engine/step";
import { cumulativeStops } from "./engine/stops";

type TickOpts = { speedMps: number; dtSeconds: number };

export async function tickVehicle(
  vehicleId: string,
  opts: TickOpts,
): Promise<{ moved: boolean; arrived: string[]; completed: boolean }> {
  const route = await prisma.route.findFirst({
    where: { vehicleId, status: "active" },
    include: { legs: { orderBy: { sequence: "asc" } } },
  });
  if (!route) return { moved: false, arrived: [], completed: false };

  const geometry = route.geometry as unknown as {
    coordinates: [number, number][];
  };
  const stops = cumulativeStops(
    route.legs.map((l) => ({ distance: l.distance, toDeliveryId: l.toDeliveryId })),
  );

  const result = simulateStep({
    coords: geometry.coordinates,
    progressMeters: route.progressMeters,
    totalMeters: route.distance,
    stops,
    speedMps: opts.speedMps,
    dtSeconds: opts.dtSeconds,
  });

  // On the first movement, mark the vehicle and its stops en_route.
  if (route.progressMeters === 0) {
    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: { status: "en_route" },
    });
    await prisma.delivery.updateMany({
      where: { vehicleId, status: "assigned" },
      data: { status: "en_route" },
    });
  }

  // Emit the position through the ingest contract (source: simulation).
  await ingestPing({
    vehicleId,
    lat: result.position.lat,
    lng: result.position.lng,
    heading: result.position.heading,
    speed: opts.speedMps,
    source: "simulation",
  });

  // Mark arrivals delivered (exactly once — they leave the en_route filter).
  for (const deliveryId of result.arrivedDeliveryIds) {
    await prisma.delivery.update({
      where: { id: deliveryId },
      data: { status: "delivered", completedAt: new Date() },
    });
    await prisma.$executeRawUnsafe(
      "SELECT pg_notify('stop_status', $1)",
      JSON.stringify({ deliveryId, status: "delivered" }),
    );
  }

  await prisma.route.update({
    where: { id: route.id },
    data: { progressMeters: result.newProgressMeters },
  });

  if (result.completed) {
    await prisma.route.update({
      where: { id: route.id },
      data: { status: "completed" },
    });
    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: { status: "idle" },
    });
  }

  return {
    moved: true,
    arrived: result.arrivedDeliveryIds,
    completed: result.completed,
  };
}

export async function tickAll(opts: TickOpts): Promise<void> {
  const routes = await prisma.route.findMany({
    where: { status: "active" },
    select: { vehicleId: true },
  });
  for (const { vehicleId } of routes) {
    await tickVehicle(vehicleId, opts);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/simulation/driver.int.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/driver.ts src/simulation/driver.int.test.ts
git commit -m "feat(sim): tick driver — move, deliver, complete via ingest contract"
```

---

### Task 6: Stop markers on the map (coloured by status)

**Files:**
- Create: `src/console/map/stops.ts`
- Test: `src/console/map/stops.test.ts`
- Create: `src/routing/routes/stops.ts` (server-side loader)
- Modify: `src/app/api/stream/route.ts` (add `stop_status` channel)
- Modify: `src/console/map/FleetMap.tsx` (stop circle layer + `stop_status` updates)
- Modify: `src/app/(app)/dashboard/page.tsx` (pass stops)

**Interfaces:**
- Consumes: `prisma`, existing `FleetMap` props.
- Produces:
  - `src/console/map/stops.ts` (pure): `type StopView = { id: string; lat: number; lng: number; status: string }`; `function stopsToGeoJson(stops: StopView[]): GeoJSON.FeatureCollection<GeoJSON.Point>` with `properties.status`.
  - `src/routing/routes/stops.ts`: `async function listRouteStops(): Promise<StopView[]>` — deliveries assigned to a vehicle with status in `assigned`/`en_route`/`delivered`.
  - SSE additionally emits `event: stop_status`.

- [ ] **Step 1: Write the unit test for the pure helper**

Create `src/console/map/stops.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { stopsToGeoJson } from "./stops";

describe("stopsToGeoJson", () => {
  it("maps stops to point features carrying id and status", () => {
    const fc = stopsToGeoJson([
      { id: "s1", lat: 51.5, lng: -0.1, status: "en_route" },
    ]);
    expect(fc.features[0].geometry.coordinates).toEqual([-0.1, 51.5]);
    expect(fc.features[0].properties?.status).toBe("en_route");
    expect(fc.features[0].properties?.id).toBe("s1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/console/map/stops.test.ts`
Expected: FAIL — cannot find module `./stops`.

- [ ] **Step 3: Implement the pure helper**

Create `src/console/map/stops.ts`:

```typescript
export type StopView = {
  id: string;
  lat: number;
  lng: number;
  status: string;
};

export function stopsToGeoJson(
  stops: StopView[],
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: stops.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      properties: { id: s.id, status: s.status },
    })),
  };
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npx vitest run src/console/map/stops.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Implement the server-side loader**

Create `src/routing/routes/stops.ts`:

```typescript
import { prisma } from "@/lib/db";
import type { StopView } from "@/console/map/stops";

export async function listRouteStops(): Promise<StopView[]> {
  const rows = await prisma.delivery.findMany({
    where: { status: { in: ["assigned", "en_route", "delivered"] } },
    orderBy: [{ vehicleId: "asc" }, { sequence: "asc" }],
  });
  return rows.map((d) => ({ id: d.id, lat: d.lat, lng: d.lng, status: d.status }));
}
```

- [ ] **Step 6: Add the `stop_status` channel to SSE**

In `src/app/api/stream/route.ts`, extend the channel list:

```typescript
const CHANNELS = ["vehicle_position", "route_updated", "stop_status"] as const;
```

- [ ] **Step 7: Render stop markers in `FleetMap` and update on `stop_status`**

In `src/console/map/FleetMap.tsx`:

(a) Add the import:

```tsx
import { stopsToGeoJson, type StopView } from "./stops";
```

(b) Add `stops` to the props and a ref (extend the existing destructure + refs):

```tsx
export function FleetMap({
  vehicles,
  routes,
  stops,
}: {
  vehicles: VehicleSummary[];
  routes: RouteView[];
  stops: StopView[];
}) {
```

Add next to the other refs:

```tsx
  const stopViews = useRef<Map<string, StopView>>(
    new Map(stops.map((s) => [s.id, s])),
  );
```

(c) Add a `renderStops` helper next to `renderRoutes`:

```tsx
    const renderStops = () => {
      const src = map.getSource("stops") as mapboxgl.GeoJSONSource | undefined;
      if (src) src.setData(stopsToGeoJson([...stopViews.current.values()]));
    };
```

(d) Inside `map.on("load", ...)`, after the `route-lines` layer is added and before the vehicle source, add the stop source + a colour-by-status circle layer:

```tsx
      map.addSource("stops", {
        type: "geojson",
        data: stopsToGeoJson([...stopViews.current.values()]),
      });
      map.addLayer({
        id: "stop-dots",
        type: "circle",
        source: "stops",
        paint: {
          "circle-radius": 6,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0f172a",
          "circle-color": [
            "match",
            ["get", "status"],
            "delivered", "#22c55e",
            "en_route", "#f59e0b",
            "#64748b",
          ],
        },
      });
```

(e) In the `EventSource` block, after the `route_updated` listener, add a `stop_status` listener:

```tsx
    es.addEventListener("stop_status", (e) => {
      const { deliveryId, status } = JSON.parse((e as MessageEvent).data) as {
        deliveryId: string;
        status: string;
      };
      const existing = stopViews.current.get(deliveryId);
      if (!existing) return;
      stopViews.current.set(deliveryId, { ...existing, status });
      renderStops();
    });
```

- [ ] **Step 8: Pass stops from the dashboard page**

In `src/app/(app)/dashboard/page.tsx`, add the import and load, then pass the prop:

```tsx
import { listRouteStops } from "@/routing/routes/stops";
```

Add before the `return`:

```tsx
  const stops = await listRouteStops();
```

And update the render:

```tsx
  return <FleetMap vehicles={vehicles} routes={routes} stops={stops} />;
```

- [ ] **Step 9: Typecheck, build, run the unit test**

Run:
```bash
npx vitest run src/console/map/stops.test.ts
npm run typecheck
npm run build
```
Expected: unit test 1 passed; typecheck exit 0; build "Compiled successfully".

- [ ] **Step 10: Commit**

```bash
git add src/console/map/stops.ts src/console/map/stops.test.ts src/routing/routes/stops.ts \
  src/app/api/stream/route.ts src/console/map/FleetMap.tsx "src/app/(app)/dashboard/page.tsx"
git commit -m "feat(console): status-coloured stop markers, live stop_status"
```

---

### Task 7: The simulator worker + end-to-end demo

**Files:**
- Create: `scripts/simulator.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `tickAll` (Task 5), `scripts/load-env.ts`.
- Produces: a persistent worker that ticks every second, plus a documented end-to-end demo.

- [ ] **Step 1: Write the worker**

Create `scripts/simulator.ts`:

```typescript
import "./load-env";
import { tickAll } from "../src/simulation/driver";

const TICK_MS = 1000;
const SPEED_MPS = Number(process.env.SIM_SPEED_MPS ?? "12"); // ~43 km/h

async function loop() {
  try {
    await tickAll({ speedMps: SPEED_MPS, dtSeconds: TICK_MS / 1000 });
  } catch (err) {
    console.error("tick error", err);
  }
}

console.log(`simulator running: ${SPEED_MPS} m/s, tick ${TICK_MS}ms`);
setInterval(loop, TICK_MS);
```

- [ ] **Step 2: Run the full stack and watch a vehicle drive its route**

Stop the Plan 1 circle mover if it is running (it fights the simulator for the same vehicle):

```bash
pkill -f "tsx scripts/demo-mover" || true
```

With Postgres up and the app running (`npm run dev`):

```bash
# 1. seed deliveries + an optimized route (from Plan 2)
npx tsx scripts/demo-deliveries.ts
# 2. drive the vehicle along that route
npx tsx scripts/simulator.ts
```

Open `http://localhost:3000/dashboard`.
Expected: the vehicle arrow **glides smoothly** along the cyan route line (not teleporting), and each grey/amber stop dot turns **green** as the vehicle reaches it. When the last stop is delivered, the vehicle stops (route completed).

Verify the data too:
```bash
docker exec helm-postgres-1 psql -U postgres -d app_dev -c \
  "select status, count(*) from \"Delivery\" group by status;"
```
Expected: deliveries transition from `en_route` to `delivered` over time.

- [ ] **Step 3: Document the simulation in the README**

Append to `README.md`:

```markdown
## Run the simulation

The simulator drives vehicles along their optimized routes, emitting positions
through the same `PositionPing` ingest contract a real telematics feed would.

```bash
npx tsx scripts/demo-deliveries.ts   # deliveries + optimized route
npx tsx scripts/simulator.ts         # glide the vehicle along it
```

Watch http://localhost:3000/dashboard: the vehicle moves smoothly along the
route and stops turn green (`delivered`) on arrival. Speed is configurable via
`SIM_SPEED_MPS`. In production this runs as a persistent Railway worker.
```

- [ ] **Step 4: Commit, then run the full suite**

```bash
git add scripts/simulator.ts README.md
git commit -m "feat(sim): persistent simulator worker + demo"
npm test
```
Expected: all tests pass.

---

## What Plan 3 delivers

The keystone that makes the console live: a simulation worker that glides vehicles along their optimized routes through the `PositionPing` contract, flips stops to `delivered` on arrival (exactly once), completes routes, and shows status-coloured stop markers updating live over SSE. **Deferred to Plan 4 (final):** the full dispatch-console UI (M6 — add/assign/optimize/reassign panels, inspect views, drag-drop) and the M7 polish (SSE reconnect, `DispatchEvent` audit trail, seed dataset, CI Postgres, release).

## Self-review notes

- **Spec coverage (M5):** tick-loop worker → Tasks 5, 7; movement along geometry → Tasks 2–3; arrival → status → Task 5; route completion → Task 5; stop visualisation → Task 6. The "swap simulation for telematics with no change above `fleet/ingest`" invariant holds — the driver's only outward write of position is `ingestPing`. ✔
- **Contract boundary:** the simulator imports `ingestPing` and emits `source: "simulation"`; it reads `Route` geometry but never calls Mapbox; nothing above `fleet/ingest` learns it was simulated. ✔
- **Arrival exactly once:** a delivered stop leaves the `en_route`/`assigned` set and its `distanceAlong` is only crossed on the tick that passes it; `simulateStep` filters `> progress && <= newProgress`, a half-open interval that fires once. ✔
- **Type consistency:** `Stop`/`StepInput`/`StepResult` (Task 3) consumed by `simulateStep` and the driver (Task 5); `cumulativeStops` (Task 4) feeds `Stop[]`; `StopView`/`stopsToGeoJson` (Task 6) match between helper, `listRouteStops`, `FleetMap`, and the dashboard; `pointAlongLine` signature matches between Tasks 2 and 3. ✔
- **Known follow-up:** `tickAll` ticks vehicles serially; fine for a handful of vehicles, revisit for scale in Plan 4. Interpolation is linear per segment (accurate for short driving segments).
```
