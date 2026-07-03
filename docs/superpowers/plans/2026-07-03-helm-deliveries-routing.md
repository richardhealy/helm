# helm — Deliveries & Routing Implementation Plan (Plan 2 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add delivery intake (address → coordinates via Mapbox Geocoding), assignment of deliveries to a vehicle, and Mapbox Optimization v1 routing that persists the optimal stop order + route geometry + per-leg ETAs and draws the route live on the map.

**Architecture:** Deliveries are geocoded on creation and land in an `unassigned` pool. Assigning stops to a vehicle and running "optimize" calls Mapbox Optimization v1 from the vehicle's depot; the result is persisted as a `Route` with ordered `RouteLeg`s and per-stop ETAs, and a `NOTIFY route_updated` redraws the map over the existing SSE channel. All Mapbox HTTP calls are split into pure URL-builders + response-parsers (unit-tested) and thin `fetch` wrappers (live integration-tested).

**Tech Stack:** Same as Plan 1 — Next 16, Prisma 7, `zod`, Vitest — plus the Mapbox Geocoding v6 and Optimization v1 HTTP APIs (server-side, `MAPBOX_TOKEN`).

## Global Constraints

Copied verbatim from `spec.md`; every task's requirements implicitly include these.

- **Single-vehicle scope:** Optimization v1 only (single-vehicle TSP from a depot). No fleet-wide VRP, no multi-vehicle assignment.
- **Optimization v1 coordinate cap:** at most 12 coordinates per request → depot + **11** stops. Cap and log if exceeded.
- **Time windows are captured and displayed, not enforced** by the optimizer in v1.
- **The ingestion contract boundary stays intact:** position data still enters only via `src/fleet/ingest`. Routing reads fleet/delivery state and writes routes; it does not produce `PositionPing`s.
- **Realtime transport:** SSE over Postgres `LISTEN/NOTIFY`. Routing emits `NOTIFY route_updated`; the dispatcher observes. Commands go over normal request handlers.
- **Secrets:** server-side Mapbox calls use `MAPBOX_TOKEN`; the map uses `NEXT_PUBLIC_MAPBOX_TOKEN`.

**Repo state at start:** Plan 1 is merged to `main`. Existing interfaces this plan consumes:
- `@/lib/db` → `prisma`
- `@/fleet/registry/vehicles` → `createDepot`, `createVehicle`, `listVehicles`, `type VehicleSummary`
- `@/realtime/listen` → `subscribe(channel, onPayload)`
- NOTIFY idiom: `await prisma.$executeRawUnsafe("SELECT pg_notify('<channel>', $1)", payload)`
- SSE route `src/app/api/stream/route.ts` (currently relays only `vehicle_position`)
- `src/console/map/FleetMap.tsx`, `src/console/map/markers.ts`
- `prisma/schema.prisma` with `Depot`, `Vehicle`, `PositionPing`

**Testing convention (unchanged):** `*.test.ts` = unit (no DB, no network). `*.int.test.ts` = integration (needs `docker compose up -d` + `npm run db:migrate`; the Mapbox-hitting ones also need `MAPBOX_TOKEN` in `.env.local`). After any `prisma migrate`, run `npm run db:generate` (migrate doesn't refresh the custom-output client). Run `npm test` for everything.

---

### Task 1: Delivery, Route, RouteLeg schema

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Consumes: existing `Vehicle` model.
- Produces: models `Delivery`, `Route`, `RouteLeg`; enums `DeliveryStatus` (`unassigned`/`assigned`/`en_route`/`delivered`/`failed`), `RouteStatus` (`draft`/`active`/`completed`). `Delivery` carries `address`, `lat`, `lng`, `status`, `vehicleId?`, `sequence?`, `serviceDuration`, optional `timeWindowStart`/`timeWindowEnd`, `assignedAt?`, `completedAt?`. `Route` carries `vehicleId`, `status`, `geometry Json`, `distance`, `duration`, `optimizedAt`. `RouteLeg` carries `routeId`, `sequence`, `distance`, `duration`, `eta`, `toDeliveryId?`.

- [ ] **Step 1: Add the models to the schema**

Append to `prisma/schema.prisma`, and add the `deliveries`/`routes` relation fields to `Vehicle` (shown as a modify below):

```prisma
enum DeliveryStatus {
  unassigned
  assigned
  en_route
  delivered
  failed
}

enum RouteStatus {
  draft
  active
  completed
}

model Delivery {
  id              String         @id @default(cuid())
  address         String
  lat             Float
  lng             Float
  status          DeliveryStatus @default(unassigned)
  vehicleId       String?
  vehicle         Vehicle?       @relation(fields: [vehicleId], references: [id])
  sequence        Int?
  serviceDuration Int            @default(0)
  timeWindowStart DateTime?
  timeWindowEnd   DateTime?
  assignedAt      DateTime?
  completedAt     DateTime?
  notes           String?
  legs            RouteLeg[]
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  @@index([vehicleId, sequence])
}

model Route {
  id         String      @id @default(cuid())
  vehicleId  String
  vehicle    Vehicle     @relation(fields: [vehicleId], references: [id], onDelete: Cascade)
  status     RouteStatus @default(active)
  geometry   Json
  distance   Float
  duration   Float
  optimizedAt DateTime   @default(now())
  legs       RouteLeg[]

  @@index([vehicleId])
}

model RouteLeg {
  id           String    @id @default(cuid())
  routeId      String
  route        Route     @relation(fields: [routeId], references: [id], onDelete: Cascade)
  sequence     Int
  distance     Float
  duration     Float
  eta          DateTime
  toDeliveryId String?
  toDelivery   Delivery? @relation(fields: [toDeliveryId], references: [id])

  @@index([routeId, sequence])
}
```

- [ ] **Step 2: Add the relations to `Vehicle`**

In the `Vehicle` model, add these two lines alongside the existing `pings` relation:

```prisma
  deliveries Delivery[]
  routes     Route[]
```

- [ ] **Step 3: Create and apply the migration, then regenerate the client**

Run:
```bash
npm run db:migrate -- --name deliveries_routing
npm run db:generate
```
Expected: a migration under `prisma/migrations/` is applied, and the client regenerates. (Run `db:generate` explicitly — migrate does not refresh the custom-output client.)

- [ ] **Step 4: Verify the models exist**

Create `src/deliveries/schema.int.test.ts`:

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";

describe("delivery schema", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a delivery with default status", async () => {
    const d = await prisma.delivery.create({
      data: { address: "10 Downing St", lat: 51.5034, lng: -0.1276 },
    });
    expect(d.status).toBe("unassigned");
    await prisma.delivery.delete({ where: { id: d.id } });
  });
});
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/deliveries/schema.int.test.ts`
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/deliveries/schema.int.test.ts
git commit -m "feat(deliveries): Delivery, Route, RouteLeg models"
```

---

### Task 2: Geocoding client (Mapbox Geocoding v6)

**Files:**
- Create: `src/deliveries/geocode/geocode.ts`
- Test: `src/deliveries/geocode/geocode.test.ts` (unit), `src/deliveries/geocode/geocode.int.test.ts` (live)

**Interfaces:**
- Consumes: `MAPBOX_TOKEN` env.
- Produces:
  - `buildGeocodeUrl(address: string, token: string): string` (pure)
  - `parseGeocode(json: unknown): { lat: number; lng: number } | null` (pure)
  - `async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null>` (fetch wrapper)

- [ ] **Step 1: Write the unit test for the pure helpers**

Create `src/deliveries/geocode/geocode.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildGeocodeUrl, parseGeocode } from "./geocode";

describe("buildGeocodeUrl", () => {
  it("encodes the address and includes the token and limit", () => {
    const url = buildGeocodeUrl("10 Downing St, London", "tok123");
    expect(url).toContain("/search/geocode/v6/forward");
    expect(url).toContain("q=10%20Downing%20St%2C%20London");
    expect(url).toContain("limit=1");
    expect(url).toContain("access_token=tok123");
  });
});

describe("parseGeocode", () => {
  it("extracts lat/lng from the first feature", () => {
    const json = { features: [{ geometry: { coordinates: [-0.1276, 51.5034] } }] };
    expect(parseGeocode(json)).toEqual({ lat: 51.5034, lng: -0.1276 });
  });

  it("returns null when there are no features", () => {
    expect(parseGeocode({ features: [] })).toBeNull();
    expect(parseGeocode({})).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/deliveries/geocode/geocode.test.ts`
Expected: FAIL — cannot find module `./geocode`.

- [ ] **Step 3: Implement the geocoder**

Create `src/deliveries/geocode/geocode.ts`:

```typescript
export function buildGeocodeUrl(address: string, token: string): string {
  const q = encodeURIComponent(address);
  return `https://api.mapbox.com/search/geocode/v6/forward?q=${q}&limit=1&access_token=${token}`;
}

export function parseGeocode(
  json: unknown,
): { lat: number; lng: number } | null {
  const features = (json as { features?: unknown[] })?.features;
  if (!Array.isArray(features) || features.length === 0) return null;
  const coords = (features[0] as { geometry?: { coordinates?: number[] } })
    ?.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const [lng, lat] = coords;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return { lat, lng };
}

export async function geocodeAddress(
  address: string,
): Promise<{ lat: number; lng: number } | null> {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) throw new Error("MAPBOX_TOKEN is not set");
  const res = await fetch(buildGeocodeUrl(address, token));
  if (!res.ok) return null;
  return parseGeocode(await res.json());
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npx vitest run src/deliveries/geocode/geocode.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Write a live integration test**

Create `src/deliveries/geocode/geocode.int.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { geocodeAddress } from "./geocode";

describe("geocodeAddress (live Mapbox)", () => {
  it("resolves a real address to plausible London coordinates", async () => {
    const result = await geocodeAddress("Trafalgar Square, London");
    expect(result).not.toBeNull();
    expect(result!.lat).toBeGreaterThan(51.3);
    expect(result!.lat).toBeLessThan(51.7);
    expect(result!.lng).toBeGreaterThan(-0.3);
    expect(result!.lng).toBeLessThan(0.1);
  });
});
```

- [ ] **Step 6: Run the live test**

Run: `npx vitest run src/deliveries/geocode/geocode.int.test.ts`
Expected: 1 passed. If it fails on response shape, inspect the real payload with:
`curl -s "https://api.mapbox.com/search/geocode/v6/forward?q=Trafalgar%20Square&limit=1&access_token=$MAPBOX_TOKEN" | head -c 800`
and adjust `parseGeocode` + its unit test to match, then re-run both.

- [ ] **Step 7: Commit**

```bash
git add src/deliveries/geocode
git commit -m "feat(deliveries): Mapbox v6 geocoding client"
```

---

### Task 3: Delivery intake and assignment

**Files:**
- Create: `src/deliveries/orders/deliveries.ts`
- Test: `src/deliveries/orders/deliveries.int.test.ts`

**Interfaces:**
- Consumes: `@/lib/db` (`prisma`), `geocodeAddress` (Task 2).
- Produces:
  - `type DeliverySummary = { id: string; address: string; lat: number; lng: number; status: string; vehicleId: string | null; sequence: number | null }`
  - `async function createDelivery(input: { address: string }): Promise<DeliverySummary>` — geocodes, then persists an `unassigned` delivery. Throws `Error("Could not geocode address")` if geocoding returns null.
  - `async function listUnassigned(): Promise<DeliverySummary[]>`
  - `async function listForVehicle(vehicleId: string): Promise<DeliverySummary[]>` — ordered by `sequence` then `createdAt`.
  - `async function assignDelivery(deliveryId: string, vehicleId: string): Promise<void>` — sets `vehicleId`, `status = "assigned"`, `assignedAt = now`.
  - `async function unassignDelivery(deliveryId: string): Promise<void>` — clears `vehicleId`/`sequence`, `status = "unassigned"`.

- [ ] **Step 1: Write the failing test**

Create `src/deliveries/orders/deliveries.int.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import {
  createDelivery,
  listUnassigned,
  listForVehicle,
  assignDelivery,
} from "./deliveries";

let vehicleId: string;
const createdDeliveries: string[] = [];

beforeAll(async () => {
  const v = await prisma.vehicle.create({ data: { label: "deliv-test" } });
  vehicleId = v.id;
});

afterAll(async () => {
  await prisma.delivery.deleteMany({ where: { id: { in: createdDeliveries } } });
  await prisma.vehicle.delete({ where: { id: vehicleId } });
  await prisma.$disconnect();
});

describe("delivery intake + assignment", () => {
  it("creates a geocoded, unassigned delivery and assigns it", async () => {
    const d = await createDelivery({ address: "Piccadilly Circus, London" });
    createdDeliveries.push(d.id);

    expect(d.status).toBe("unassigned");
    expect(Math.abs(d.lat - 51.51)).toBeLessThan(0.1);

    const unassigned = await listUnassigned();
    expect(unassigned.some((x) => x.id === d.id)).toBe(true);

    await assignDelivery(d.id, vehicleId);
    const forVehicle = await listForVehicle(vehicleId);
    const found = forVehicle.find((x) => x.id === d.id);
    expect(found?.status).toBe("assigned");
    expect(found?.vehicleId).toBe(vehicleId);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/deliveries/orders/deliveries.int.test.ts`
Expected: FAIL — cannot find module `./deliveries`.

- [ ] **Step 3: Implement intake + assignment**

Create `src/deliveries/orders/deliveries.ts`:

```typescript
import { prisma } from "@/lib/db";
import { geocodeAddress } from "@/deliveries/geocode/geocode";

export type DeliverySummary = {
  id: string;
  address: string;
  lat: number;
  lng: number;
  status: string;
  vehicleId: string | null;
  sequence: number | null;
};

type DeliveryRow = {
  id: string;
  address: string;
  lat: number;
  lng: number;
  status: string;
  vehicleId: string | null;
  sequence: number | null;
};

function toSummary(d: DeliveryRow): DeliverySummary {
  return {
    id: d.id,
    address: d.address,
    lat: d.lat,
    lng: d.lng,
    status: d.status,
    vehicleId: d.vehicleId,
    sequence: d.sequence,
  };
}

export async function createDelivery(input: {
  address: string;
}): Promise<DeliverySummary> {
  const coords = await geocodeAddress(input.address);
  if (!coords) throw new Error("Could not geocode address");
  const d = await prisma.delivery.create({
    data: { address: input.address, lat: coords.lat, lng: coords.lng },
  });
  return toSummary(d);
}

export async function listUnassigned(): Promise<DeliverySummary[]> {
  const rows = await prisma.delivery.findMany({
    where: { status: "unassigned" },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toSummary);
}

export async function listForVehicle(
  vehicleId: string,
): Promise<DeliverySummary[]> {
  const rows = await prisma.delivery.findMany({
    where: { vehicleId },
    orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toSummary);
}

export async function assignDelivery(
  deliveryId: string,
  vehicleId: string,
): Promise<void> {
  await prisma.delivery.update({
    where: { id: deliveryId },
    data: { vehicleId, status: "assigned", assignedAt: new Date() },
  });
}

export async function unassignDelivery(deliveryId: string): Promise<void> {
  await prisma.delivery.update({
    where: { id: deliveryId },
    data: { vehicleId: null, sequence: null, status: "unassigned" },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/deliveries/orders/deliveries.int.test.ts`
Expected: 1 passed. (Needs `MAPBOX_TOKEN` — `createDelivery` geocodes.)

- [ ] **Step 5: Commit**

```bash
git add src/deliveries/orders
git commit -m "feat(deliveries): intake + assignment"
```

---

### Task 4: Optimization client (Mapbox Optimization v1)

**Files:**
- Create: `src/routing/optimize/optimize.ts`
- Test: `src/routing/optimize/optimize.test.ts` (unit), `src/routing/optimize/optimize.int.test.ts` (live)

**Interfaces:**
- Consumes: `MAPBOX_TOKEN`.
- Produces:
  - `type LngLat = { lat: number; lng: number }`
  - `type OptimizedTrip = { geometry: GeoJSON.LineString; distance: number; duration: number; legs: { distance: number; duration: number }[]; orderedStopIndices: number[] }`
  - `buildOptimizationUrl(coords: LngLat[], token: string): string` (pure) — `coords[0]` is the depot; builds an `optimized-trips/v1` URL with `source=first&roundtrip=false&destination=any&geometries=geojson&overview=full`.
  - `parseOptimization(json: unknown): OptimizedTrip | null` (pure) — `orderedStopIndices` are indices into the **stops** (input coords minus the depot), in visiting order.
  - `async function optimizeTrip(coords: LngLat[]): Promise<OptimizedTrip | null>` (fetch wrapper)

- [ ] **Step 1: Write the unit test for the pure helpers**

Create `src/routing/optimize/optimize.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildOptimizationUrl, parseOptimization } from "./optimize";

describe("buildOptimizationUrl", () => {
  it("puts the depot first and sets the v1 params", () => {
    const url = buildOptimizationUrl(
      [
        { lat: 51.5, lng: -0.12 },
        { lat: 51.51, lng: -0.13 },
      ],
      "tok",
    );
    expect(url).toContain("/optimized-trips/v1/mapbox/driving/");
    expect(url).toContain("-0.12,51.5;-0.13,51.51");
    expect(url).toContain("source=first");
    expect(url).toContain("roundtrip=false");
    expect(url).toContain("geometries=geojson");
    expect(url).toContain("access_token=tok");
  });
});

describe("parseOptimization", () => {
  // depot (input 0) + two stops (input 1, 2). Optimizer visits stop 2 before stop 1:
  // waypoint_index: depot=0, stop1(input1)=2, stop2(input2)=1
  const json = {
    code: "Ok",
    waypoints: [
      { waypoint_index: 0 },
      { waypoint_index: 2 },
      { waypoint_index: 1 },
    ],
    trips: [
      {
        distance: 3000,
        duration: 600,
        geometry: { type: "LineString", coordinates: [[-0.12, 51.5]] },
        legs: [
          { distance: 1000, duration: 200 },
          { distance: 2000, duration: 400 },
        ],
      },
    ],
  };

  it("orders stops by waypoint_index (visiting order)", () => {
    const trip = parseOptimization(json);
    expect(trip).not.toBeNull();
    // input stop 2 (index 1 in stops array) is visited first
    expect(trip!.orderedStopIndices).toEqual([1, 0]);
    expect(trip!.legs).toHaveLength(2);
    expect(trip!.duration).toBe(600);
  });

  it("returns null on a non-Ok code", () => {
    expect(parseOptimization({ code: "NoRoute" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/routing/optimize/optimize.test.ts`
Expected: FAIL — cannot find module `./optimize`.

- [ ] **Step 3: Implement the optimization client**

Create `src/routing/optimize/optimize.ts`:

```typescript
export type LngLat = { lat: number; lng: number };

export type OptimizedTrip = {
  geometry: GeoJSON.LineString;
  distance: number;
  duration: number;
  legs: { distance: number; duration: number }[];
  orderedStopIndices: number[];
};

export function buildOptimizationUrl(coords: LngLat[], token: string): string {
  const path = coords.map((c) => `${c.lng},${c.lat}`).join(";");
  const params = new URLSearchParams({
    source: "first",
    roundtrip: "false",
    destination: "any",
    geometries: "geojson",
    overview: "full",
    access_token: token,
  });
  return `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${path}?${params.toString()}`;
}

export function parseOptimization(json: unknown): OptimizedTrip | null {
  const o = json as {
    code?: string;
    waypoints?: { waypoint_index: number }[];
    trips?: {
      distance: number;
      duration: number;
      geometry: GeoJSON.LineString;
      legs: { distance: number; duration: number }[];
    }[];
  };
  if (o?.code !== "Ok" || !o.waypoints || !o.trips || o.trips.length === 0) {
    return null;
  }
  const trip = o.trips[0];
  // waypoints[0] is the depot (source=first). The remaining waypoints map 1:1
  // to the input stops; sort those stop indices by their optimized position.
  const stops = o.waypoints
    .slice(1)
    .map((w, i) => ({ stopIndex: i, waypointIndex: w.waypoint_index }));
  stops.sort((a, b) => a.waypointIndex - b.waypointIndex);
  return {
    geometry: trip.geometry,
    distance: trip.distance,
    duration: trip.duration,
    legs: trip.legs.map((l) => ({ distance: l.distance, duration: l.duration })),
    orderedStopIndices: stops.map((s) => s.stopIndex),
  };
}

export async function optimizeTrip(
  coords: LngLat[],
): Promise<OptimizedTrip | null> {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) throw new Error("MAPBOX_TOKEN is not set");
  const res = await fetch(buildOptimizationUrl(coords, token));
  if (!res.ok) return null;
  return parseOptimization(await res.json());
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npx vitest run src/routing/optimize/optimize.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Write a live integration test**

Create `src/routing/optimize/optimize.int.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { optimizeTrip } from "./optimize";

describe("optimizeTrip (live Mapbox)", () => {
  it("returns an ordered trip for a depot + 3 stops", async () => {
    const trip = await optimizeTrip([
      { lat: 51.5, lng: -0.12 }, // depot
      { lat: 51.52, lng: -0.1 },
      { lat: 51.49, lng: -0.14 },
      { lat: 51.51, lng: -0.09 },
    ]);
    expect(trip).not.toBeNull();
    expect(trip!.orderedStopIndices).toHaveLength(3);
    expect(new Set(trip!.orderedStopIndices)).toEqual(new Set([0, 1, 2]));
    expect(trip!.geometry.type).toBe("LineString");
    expect(trip!.legs.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 6: Run the live test**

Run: `npx vitest run src/routing/optimize/optimize.int.test.ts`
Expected: 1 passed. If the response shape differs, inspect it with:
`curl -s "https://api.mapbox.com/optimized-trips/v1/mapbox/driving/-0.12,51.5;-0.1,51.52;-0.14,51.49?source=first&roundtrip=false&destination=any&geometries=geojson&overview=full&access_token=$MAPBOX_TOKEN" | head -c 1000`
and reconcile `parseOptimization` + its unit test.

- [ ] **Step 7: Commit**

```bash
git add src/routing/optimize
git commit -m "feat(routing): Mapbox Optimization v1 client"
```

---

### Task 5: Route persistence + optimize-for-vehicle

**Files:**
- Create: `src/routing/routes/routes.ts`
- Test: `src/routing/routes/routes.int.test.ts`

**Interfaces:**
- Consumes: `@/lib/db` (`prisma`), `optimizeTrip`/`OptimizedTrip`/`LngLat` (Task 4), the `route_updated` NOTIFY channel.
- Produces:
  - `async function persistRoute(vehicleId: string, orderedDeliveryIds: string[], trip: OptimizedTrip, startedAt: Date): Promise<{ routeId: string }>` — replaces any existing route for the vehicle, creates `Route` + one `RouteLeg` per stop (ETA = `startedAt` + cumulative leg durations), sets each delivery's `sequence`, and emits `NOTIFY route_updated`. Pure of any network call, so it is unit/DB-testable with a synthetic `trip`.
  - `async function optimizeRouteForVehicle(vehicleId: string): Promise<{ routeId: string } | null>` — loads the vehicle's depot + its `assigned` deliveries (capped at 11), calls `optimizeTrip`, reorders the deliveries, and calls `persistRoute`. Returns `null` if there is no depot or no assigned deliveries.
  - `async function getActiveRoute(vehicleId: string): Promise<{ id: string; geometry: unknown; legs: { sequence: number; eta: Date; toDeliveryId: string | null }[] } | null>`

- [ ] **Step 1: Write the failing test (persistRoute with a synthetic trip — no network)**

Create `src/routing/routes/routes.int.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { persistRoute, getActiveRoute } from "./routes";
import type { OptimizedTrip } from "@/routing/optimize/optimize";

let vehicleId: string;
const deliveryIds: string[] = [];

beforeAll(async () => {
  const v = await prisma.vehicle.create({ data: { label: "route-test" } });
  vehicleId = v.id;
  for (const addr of ["A", "B"]) {
    const d = await prisma.delivery.create({
      data: { address: addr, lat: 51.5, lng: -0.12, status: "assigned", vehicleId },
    });
    deliveryIds.push(d.id);
  }
});

afterAll(async () => {
  await prisma.routeLeg.deleteMany({ where: { toDeliveryId: { in: deliveryIds } } });
  await prisma.route.deleteMany({ where: { vehicleId } });
  await prisma.delivery.deleteMany({ where: { id: { in: deliveryIds } } });
  await prisma.vehicle.delete({ where: { id: vehicleId } });
  await prisma.$disconnect();
});

describe("persistRoute", () => {
  it("persists a route with per-stop ETAs and sequences", async () => {
    const trip: OptimizedTrip = {
      geometry: { type: "LineString", coordinates: [[-0.12, 51.5], [-0.1, 51.52]] },
      distance: 3000,
      duration: 600,
      legs: [
        { distance: 1000, duration: 200 },
        { distance: 2000, duration: 400 },
      ],
      orderedStopIndices: [1, 0],
    };
    // visiting order: deliveryIds[1] then deliveryIds[0]
    const ordered = [deliveryIds[1], deliveryIds[0]];
    const start = new Date("2026-07-03T09:00:00Z");

    const { routeId } = await persistRoute(vehicleId, ordered, trip, start);
    expect(routeId).toBeTruthy();

    const active = await getActiveRoute(vehicleId);
    expect(active?.legs).toHaveLength(2);
    // first stop ETA = start + 200s
    expect(active!.legs[0].eta.toISOString()).toBe("2026-07-03T09:03:20.000Z");
    // second stop ETA = start + 200s + 400s
    expect(active!.legs[1].eta.toISOString()).toBe("2026-07-03T09:10:00.000Z");
    expect(active!.legs[0].toDeliveryId).toBe(deliveryIds[1]);

    const first = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryIds[1] } });
    expect(first.sequence).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/routing/routes/routes.int.test.ts`
Expected: FAIL — cannot find module `./routes`.

- [ ] **Step 3: Implement route persistence + optimize-for-vehicle**

Create `src/routing/routes/routes.ts`:

```typescript
import { prisma } from "@/lib/db";
import { optimizeTrip, type OptimizedTrip, type LngLat } from "@/routing/optimize/optimize";

const MAX_STOPS = 11; // Optimization v1: depot + 11 stops = 12 coordinates

export async function persistRoute(
  vehicleId: string,
  orderedDeliveryIds: string[],
  trip: OptimizedTrip,
  startedAt: Date,
): Promise<{ routeId: string }> {
  // Replace any existing route for this vehicle (cascade removes its legs).
  await prisma.route.deleteMany({ where: { vehicleId } });

  const route = await prisma.route.create({
    data: {
      vehicleId,
      status: "active",
      geometry: trip.geometry as unknown as object,
      distance: trip.distance,
      duration: trip.duration,
      optimizedAt: startedAt,
    },
  });

  let cumulativeMs = 0;
  for (let i = 0; i < orderedDeliveryIds.length; i++) {
    cumulativeMs += (trip.legs[i]?.duration ?? 0) * 1000;
    const eta = new Date(startedAt.getTime() + cumulativeMs);
    await prisma.routeLeg.create({
      data: {
        routeId: route.id,
        sequence: i,
        distance: trip.legs[i]?.distance ?? 0,
        duration: trip.legs[i]?.duration ?? 0,
        eta,
        toDeliveryId: orderedDeliveryIds[i],
      },
    });
    await prisma.delivery.update({
      where: { id: orderedDeliveryIds[i] },
      data: { sequence: i },
    });
  }

  const payload = JSON.stringify({ vehicleId, routeId: route.id });
  await prisma.$executeRawUnsafe("SELECT pg_notify('route_updated', $1)", payload);

  return { routeId: route.id };
}

export async function optimizeRouteForVehicle(
  vehicleId: string,
): Promise<{ routeId: string } | null> {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    include: { depot: true },
  });
  if (!vehicle?.depot) return null;

  const deliveries = await prisma.delivery.findMany({
    where: { vehicleId, status: "assigned" },
    orderBy: { createdAt: "asc" },
    take: MAX_STOPS,
  });
  if (deliveries.length === 0) return null;

  const coords: LngLat[] = [
    { lat: vehicle.depot.lat, lng: vehicle.depot.lng },
    ...deliveries.map((d) => ({ lat: d.lat, lng: d.lng })),
  ];

  const trip = await optimizeTrip(coords);
  if (!trip) return null;

  const ordered = trip.orderedStopIndices.map((i) => deliveries[i].id);
  return persistRoute(vehicleId, ordered, trip, new Date());
}

export async function getActiveRoute(vehicleId: string) {
  const route = await prisma.route.findFirst({
    where: { vehicleId, status: "active" },
    include: { legs: { orderBy: { sequence: "asc" } } },
  });
  if (!route) return null;
  return {
    id: route.id,
    geometry: route.geometry,
    legs: route.legs.map((l) => ({
      sequence: l.sequence,
      eta: l.eta,
      toDeliveryId: l.toDeliveryId,
    })),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/routing/routes/routes.int.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/routing/routes
git commit -m "feat(routing): route persistence + optimize-for-vehicle"
```

---

### Task 6: HTTP routes — create delivery, optimize vehicle

**Files:**
- Create: `src/app/api/deliveries/route.ts`
- Create: `src/app/api/vehicles/[id]/optimize/route.ts`
- Test: `src/app/api/deliveries/route.int.test.ts`

**Interfaces:**
- Consumes: `createDelivery` (Task 3), `optimizeRouteForVehicle` (Task 5).
- Produces:
  - `POST /api/deliveries` — body `{ address: string }`; `400` on missing address or geocode failure; `201` + `DeliverySummary` on success.
  - `POST /api/vehicles/[id]/optimize` — optimizes the vehicle's assigned deliveries; `200` + `{ routeId }`, or `409` + `{ error }` when there is no depot or no assigned deliveries.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/deliveries/route.int.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/api/deliveries/route.int.test.ts`
Expected: FAIL — cannot find module `./route`.

- [ ] **Step 3: Implement the delivery route**

Create `src/app/api/deliveries/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { createDelivery } from "@/deliveries/orders/deliveries";

const body = z.object({ address: z.string().min(1) });

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }
  try {
    const delivery = await createDelivery(parsed.data);
    return NextResponse.json(delivery, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Could not geocode address" },
      { status: 400 },
    );
  }
}
```

- [ ] **Step 4: Implement the optimize route**

Create `src/app/api/vehicles/[id]/optimize/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { optimizeRouteForVehicle } from "@/routing/routes/routes";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await optimizeRouteForVehicle(id);
  if (!result) {
    return NextResponse.json(
      { error: "No depot or no assigned deliveries" },
      { status: 409 },
    );
  }
  return NextResponse.json(result, { status: 200 });
}
```

Note: in Next 16, dynamic route `params` is a Promise and must be awaited.

- [ ] **Step 5: Run the delivery route test**

Run: `npx vitest run src/app/api/deliveries/route.int.test.ts`
Expected: 2 passed.

- [ ] **Step 6: Typecheck (covers the optimize route) and commit**

Run: `npm run typecheck` (expect exit 0), then:

```bash
git add src/app/api/deliveries src/app/api/vehicles
git commit -m "feat(api): create-delivery + optimize-vehicle routes"
```

---

### Task 7: Draw routes on the map + relay route_updated over SSE

**Files:**
- Create: `src/console/map/routes.ts`
- Test: `src/console/map/routes.test.ts`
- Create: `src/app/api/vehicles/[id]/route/route.ts`
- Modify: `src/app/api/stream/route.ts` (add the `route_updated` channel)
- Modify: `src/console/map/FleetMap.tsx` (route line + stop layers, redraw on `route_updated`)
- Modify: `src/app/(app)/dashboard/page.tsx` (pass active routes)

**Interfaces:**
- Consumes: `getActiveRoute` (Task 5), `subscribe` (Plan 1), `VehicleSummary` (Plan 1).
- Produces:
  - `src/console/map/routes.ts`: pure helpers —
    - `type RouteView = { vehicleId: string; geometry: GeoJSON.LineString }`
    - `function routesToGeoJson(routes: RouteView[]): GeoJSON.FeatureCollection<GeoJSON.LineString>`
  - `GET /api/vehicles/[id]/route` → `{ geometry }` (active route) or `404`.
  - SSE `/api/stream` additionally emits `event: route_updated`.

- [ ] **Step 1: Write the unit test for the route helper**

Create `src/console/map/routes.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { routesToGeoJson } from "./routes";

describe("routesToGeoJson", () => {
  it("wraps route geometries as line features keyed by vehicle", () => {
    const fc = routesToGeoJson([
      {
        vehicleId: "v1",
        geometry: { type: "LineString", coordinates: [[-0.12, 51.5], [-0.1, 51.52]] },
      },
    ]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features[0].geometry.type).toBe("LineString");
    expect(fc.features[0].properties?.vehicleId).toBe("v1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/console/map/routes.test.ts`
Expected: FAIL — cannot find module `./routes`.

- [ ] **Step 3: Implement the route helper**

Create `src/console/map/routes.ts`:

```typescript
export type RouteView = {
  vehicleId: string;
  geometry: GeoJSON.LineString;
};

export function routesToGeoJson(
  routes: RouteView[],
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: "FeatureCollection",
    features: routes.map((r) => ({
      type: "Feature",
      geometry: r.geometry,
      properties: { vehicleId: r.vehicleId },
    })),
  };
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npx vitest run src/console/map/routes.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Add the per-vehicle active-route endpoint**

Create `src/app/api/vehicles/[id]/route/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getActiveRoute } from "@/routing/routes/routes";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const route = await getActiveRoute(id);
  if (!route) return NextResponse.json({ error: "no active route" }, { status: 404 });
  return NextResponse.json({ geometry: route.geometry });
}
```

- [ ] **Step 6: Relay `route_updated` over SSE**

Replace the body of `src/app/api/stream/route.ts` with a multi-channel version:

```typescript
import { subscribe } from "@/realtime/listen";

export const dynamic = "force-dynamic";

const CHANNELS = ["vehicle_position", "route_updated"] as const;

export async function GET() {
  const encoder = new TextEncoder();
  let cleanups: Array<() => Promise<void>> = [];
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      cleanups = await Promise.all(
        CHANNELS.map((channel) =>
          subscribe(channel, (payload) => {
            controller.enqueue(
              encoder.encode(`event: ${channel}\ndata: ${payload}\n\n`),
            );
          }),
        ),
      );
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 15000);
    },
    async cancel() {
      if (heartbeat) clearInterval(heartbeat);
      await Promise.all(cleanups.map((c) => c()));
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 7: Draw routes in `FleetMap` and redraw on `route_updated`**

In `src/console/map/FleetMap.tsx`, make these changes:

(a) Update the imports and props:

```tsx
import { routesToGeoJson, type RouteView } from "./routes";
```

Change the component signature and add a routes ref:

```tsx
export function FleetMap({
  vehicles,
  routes,
}: {
  vehicles: VehicleSummary[];
  routes: RouteView[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const positions = useRef<Map<string, VehiclePosition>>(
    new Map(initialPositions(vehicles).map((p) => [p.vehicleId, p])),
  );
  const routeViews = useRef<Map<string, RouteView>>(
    new Map(routes.map((r) => [r.vehicleId, r])),
  );
```

(b) Inside `map.on("load", ...)`, after the vehicle source/layer are added, add the route source + line layer **before** the arrow layer so lines sit under the markers. Insert this just before `map.addLayer({ id: "vehicles-arrows", ... })`:

```tsx
      map.addSource("routes", {
        type: "geojson",
        data: routesToGeoJson([...routeViews.current.values()]),
      });
      map.addLayer({
        id: "route-lines",
        type: "line",
        source: "routes",
        paint: {
          "line-color": "#38bdf8",
          "line-width": 3,
          "line-opacity": 0.7,
        },
      });
```

(c) Add a `renderRoutes` helper next to the existing `render`:

```tsx
    const renderRoutes = () => {
      const src = map.getSource("routes") as mapboxgl.GeoJSONSource | undefined;
      if (src) src.setData(routesToGeoJson([...routeViews.current.values()]));
    };
```

(d) In the `EventSource` block, after the existing `vehicle_position` listener, add a `route_updated` listener that fetches the fresh geometry and redraws:

```tsx
    es.addEventListener("route_updated", async (e) => {
      const { vehicleId } = JSON.parse((e as MessageEvent).data) as {
        vehicleId: string;
      };
      const res = await fetch(`/api/vehicles/${vehicleId}/route`);
      if (!res.ok) return;
      const { geometry } = (await res.json()) as { geometry: GeoJSON.LineString };
      routeViews.current.set(vehicleId, { vehicleId, geometry });
      renderRoutes();
    });
```

- [ ] **Step 8: Pass active routes from the dashboard page**

Replace `src/app/(app)/dashboard/page.tsx` with:

```tsx
import { listVehicles } from "@/fleet/registry/vehicles";
import { getActiveRoute } from "@/routing/routes/routes";
import { FleetMap } from "@/console/map/FleetMap";
import type { RouteView } from "@/console/map/routes";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const vehicles = await listVehicles();
  const routes: RouteView[] = [];
  for (const v of vehicles) {
    const route = await getActiveRoute(v.id);
    if (route) {
      routes.push({ vehicleId: v.id, geometry: route.geometry as GeoJSON.LineString });
    }
  }
  return <FleetMap vehicles={vehicles} routes={routes} />;
}
```

- [ ] **Step 9: Typecheck, build, and run the map unit test**

Run:
```bash
npx vitest run src/console/map/routes.test.ts
npm run typecheck
npm run build
```
Expected: unit test 1 passed; typecheck exit 0; build "Compiled successfully" with `/api/deliveries`, `/api/vehicles/[id]/optimize`, `/api/vehicles/[id]/route` in the route table.

- [ ] **Step 10: Commit**

```bash
git add src/console/map/routes.ts src/console/map/routes.test.ts \
  "src/app/api/vehicles/[id]/route" src/app/api/stream/route.ts \
  src/console/map/FleetMap.tsx "src/app/(app)/dashboard/page.tsx"
git commit -m "feat(console): draw optimized routes, relay route_updated over SSE"
```

---

### Task 8: Demo — deliveries + optimized route on the map

**Files:**
- Create: `scripts/demo-deliveries.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `createDepot`/`createVehicle`/`listVehicles` (Plan 1), `POST /api/deliveries`, `assignDelivery`, `POST /api/vehicles/[id]/optimize`.
- Produces: a script that ensures a depot + vehicle, creates a handful of deliveries by address, assigns them, and triggers optimization — so the dashboard shows an optimized route line through ordered stops.

- [ ] **Step 1: Write the demo script**

Create `scripts/demo-deliveries.ts`:

```typescript
import "./load-env";
import { createDepot, createVehicle, listVehicles } from "../src/fleet/registry/vehicles";
import { assignDelivery } from "../src/deliveries/orders/deliveries";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const ADDRESSES = [
  "Covent Garden, London",
  "British Museum, London",
  "St Paul's Cathedral, London",
  "Tate Modern, London",
  "Borough Market, London",
];

async function ensureVehicle(): Promise<string> {
  const existing = await listVehicles();
  if (existing.length > 0 && existing[0].lat !== null) return existing[0].id;
  const depot = await createDepot({ name: "Demo Depot", lat: 51.5, lng: -0.12 });
  const vehicle = await createVehicle({ label: "Demo Van", depotId: depot.id });
  return vehicle.id;
}

async function main() {
  const vehicleId = await ensureVehicle();

  for (const address of ADDRESSES) {
    const res = await fetch(`${APP_URL}/api/deliveries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
    });
    if (!res.ok) {
      console.error("create delivery failed", address, res.status);
      continue;
    }
    const delivery = (await res.json()) as { id: string };
    await assignDelivery(delivery.id, vehicleId);
    console.log(`added + assigned: ${address}`);
  }

  const opt = await fetch(`${APP_URL}/api/vehicles/${vehicleId}/optimize`, {
    method: "POST",
  });
  console.log("optimize:", opt.status, await opt.text());
  console.log(`Open ${APP_URL}/dashboard — the optimized route should be drawn.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the full stack and verify a route is drawn**

With Postgres up and the schema migrated:

```bash
npm run dev                                   # terminal 1
NEXT_PUBLIC_APP_URL=http://localhost:3000 npx tsx scripts/demo-deliveries.ts   # terminal 2
```

Open `http://localhost:3000/dashboard`.
Expected: five stops around central London joined by a cyan route line in optimized order, with the vehicle arrow at the depot. The `optimize` call prints `200` and a `routeId`.

Also verify the route persisted and has ETAs:
```bash
curl -s http://localhost:3000/api/vehicles/$(docker exec helm-postgres-1 psql -U postgres -d app_dev -t -A -c "select id from \"Vehicle\" limit 1")/route | head -c 300
```
Expected: JSON with a `geometry` of type `LineString`.

- [ ] **Step 3: Document the routing demo in the README**

Append to `README.md`:

```markdown
## Run the routing demo

With the app running (`npm run dev`) and Postgres up:

```bash
npx tsx scripts/demo-deliveries.ts
```

This geocodes five London addresses, assigns them to the demo vehicle, and
runs Mapbox Optimization v1 — the dashboard then draws the optimized route
through the ordered stops. Re-running `optimize` after adding/removing stops
redraws the route live over SSE (`route_updated`).
```

- [ ] **Step 4: Commit, then run the full suite**

```bash
git add scripts/demo-deliveries.ts README.md
git commit -m "feat: deliveries + routing demo"
npm test
```
Expected: all tests pass (unit + integration; the Mapbox-hitting ones need `MAPBOX_TOKEN`).

---

## What Plan 2 delivers

Deliveries created by address (geocoded), assigned to a vehicle, and routed via Mapbox Optimization v1 — the optimized order, geometry, and per-stop ETAs persisted and drawn live on the dashboard, redrawing over SSE when a route changes. **Deferred to later plans:** the persistent simulation worker moving vehicles along these routes + arrival→`delivered` transitions + the full assign/optimize/reassign dispatch UX (Plan 3); SSE reconnect, `DispatchEvent` audit trail, CI Postgres, release (Plan 4).

## Self-review notes

- **Spec coverage (M3–M4):** delivery intake + geocoding → Tasks 2–3, 6; status lifecycle (`unassigned`/`assigned`) → Tasks 1, 3; assign-and-optimize + persisted routes/legs/ETAs → Tasks 4–6; route overlays + live redraw → Task 7; end-to-end demo → Task 8. `en_route`/`delivered` transitions are driven by the simulation engine in Plan 3 (correctly out of scope here). Reassignment re-optimization is exercised by re-running `optimize` (Task 8 note); the drag-drop dispatch UX is Plan 3.
- **Contract boundary:** routing reads fleet/delivery state and writes routes; it emits `route_updated`, never a `PositionPing`. The ingest boundary is untouched. ✔
- **Type consistency:** `OptimizedTrip`/`LngLat` (Task 4) flow into `persistRoute`/`optimizeRouteForVehicle` (Task 5); `DeliverySummary` (Task 3) is returned by `POST /api/deliveries` (Task 6); `RouteView` + `routesToGeoJson` (Task 7) match between the helper, `FleetMap`, and the dashboard page; `getActiveRoute`'s return shape (`{ id, geometry, legs[] }`) is consumed by Task 6's `/route` endpoint and Task 8. `params` is awaited in both dynamic routes (Next 16). ✔
- **Known follow-up:** `Route.geometry` is stored as `Json`; the dashboard casts it to `GeoJSON.LineString`. Acceptable for v1; a zod parse at the read boundary is a Plan 4 hardening item.
```
