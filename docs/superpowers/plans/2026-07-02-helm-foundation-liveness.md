# helm — Foundation & Liveness Implementation Plan (Plan 1 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the blueprint modules into the existing helm repo and build the "liveness" half of the dispatch console — a Mapbox map that renders the fleet and updates in real time over SSE, fed through the normalized `PositionPing` ingestion contract.

**Architecture:** Next.js 16 App Router app. Postgres (via Prisma 7) is the source of truth for fleet state. Position data enters only through `src/fleet/ingest` (the `PositionPing` contract); ingest writes an append-only ping, projects the vehicle's current position, and emits a Postgres `NOTIFY`. An SSE route holds a dedicated `pg` `LISTEN` connection and relays those notifications to the browser, where a Mapbox GL map moves the vehicle markers.

**Tech Stack:** Next.js 16, React 19, TypeScript (ESM), Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`), Auth.js v5, `mapbox-gl`, `pg` (for `LISTEN`), `zod` (contract validation), Vitest.

## Global Constraints

Copied verbatim from `spec.md`; every task's requirements implicitly include these.

- **Stack floors:** Next.js 16, React 19, TypeScript ESM, Prisma 7, Auth.js v5.
- **The ingestion contract is the boundary:** everything above `src/fleet/ingest` consumes only the normalized `PositionPing` shape. No consumer references the simulator or any telematics provider directly.
- **`PositionPing` fields:** `vehicleId`, `lat`, `lng`, `heading`, `speed`, `timestamp`, `source` (`simulation` | `telematics`).
- **Single-vehicle scope:** no fleet-wide VRP; no multi-vehicle assignment. (Routing itself is Plan 2.)
- **Auth:** database sessions via the Prisma adapter (Google is the active provider; `GOOGLE_AUTH=true`).
- **Realtime transport:** Server-Sent Events over Postgres `LISTEN/NOTIFY`. One-directional; commands use normal request handlers.
- **Secrets:** `MAPBOX_TOKEN` / `NEXT_PUBLIC_MAPBOX_TOKEN` for Mapbox APIs + GL JS; `DATABASE_URL` for Postgres. App secrets, not blueprint toggles.
- **Deploy target:** Railway (persistent worker arrives in Plan 3).

**Repo state at start:** `blueprint-projects/helm/` already contains a bare Next.js 16 skeleton (`src/app/{layout,page}.tsx`, `next.config.ts`, Tailwind v4) pushed to `github.com/richardhealy/helm`. It has **no** blueprint modules yet — Task 1 folds them in from `../../setup-project/blueprint/templates/`.

**Testing convention:** Unit tests (`*.test.ts`) need no database. Integration tests (`*.int.test.ts`) require a running Postgres — start it with `docker compose up -d` and apply the schema with `npm run db:migrate` (or `db:push`) before running them. `npm test` runs everything; `npm run test:unit` runs only unit tests.

---

### Task 1: Fold in blueprint modules and reach a green baseline

**Files:**
- Overlay (copy from `../../setup-project/blueprint/templates/<module>/.`): `base`, `db-postgres`, `auth-email`, `auth-google`, `sentry`, `website`, `ci`
- Create: `vitest.config.ts`, `src/test/setup.ts`
- Modify: `package.json` (scripts + deps), `.env.example` (add Mapbox + test DB)
- Modify: `prisma/schema.prisma` (arrives via `db-postgres` overlay)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `@/lib/db` exporting `prisma` (Prisma 7 client singleton); `@/auth` exporting `{ handlers, auth, signIn, signOut }`; `npm test`, `npm run build`, `npm run db:migrate`, `npm run db:push` scripts; a running local Postgres via `docker compose`.

- [ ] **Step 1: Overlay the blueprint modules into the repo**

From the helm repo root, copy each module's contents in dependency order (later modules intentionally win on `providers.ts` and `next.config.ts`):

```bash
cd /Users/richardfernandez/Code/blueprint-projects/helm
T=../../setup-project/blueprint/templates
for m in base db-postgres auth-email auth-google sentry website ci; do
  cp -r "$T/$m/." .
done
```

- [ ] **Step 2: Add project dependencies and scripts**

Install the module deps the scaffolder would have installed, plus this plan's libraries:

```bash
npm install next-auth@beta @auth/prisma-adapter prisma @prisma/client @prisma/adapter-pg pg dotenv @sentry/nextjs mapbox-gl zod
npm install -D @types/pg @types/mapbox-gl vitest @vitejs/plugin-react jsdom tsx
```

Then edit `package.json` `scripts` to read exactly:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run --dir src --exclude \"**/*.int.test.ts\"",
    "db:generate": "prisma generate",
    "db:push": "prisma db push",
    "db:migrate": "prisma migrate dev"
  }
}
```

- [ ] **Step 3: Add the Vitest config and a jsdom setup file**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    setupFiles: ["src/test/setup.ts"],
    environmentMatchGlobs: [["src/console/**", "jsdom"]],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
```

Create `src/test/setup.ts`:

```typescript
import { config } from "dotenv";
// Load the same env files the app and Prisma CLI use, so integration tests
// hit the local database.
config({ path: [".env.local", ".env"] });
```

- [ ] **Step 4: Add Mapbox + test env to `.env.example`**

Append to `.env.example`:

```bash
# ── Mapbox ────────────────────────────────────────────────────────────────────
# Optimization v1 + Directions + Geocoding + GL JS all use this token.
MAPBOX_TOKEN=
NEXT_PUBLIC_MAPBOX_TOKEN=
```

Then create your working env and start Postgres:

```bash
cp .env.example .env.local
# Fill AUTH_SECRET (openssl rand -base64 32), GOOGLE_CLIENT_ID/SECRET,
# and both MAPBOX_TOKEN vars. DATABASE_URL already points at the local db.
docker compose up -d
```

- [ ] **Step 5: Generate the Prisma client, then verify typecheck and build**

Run:
```bash
npm run db:generate
npm run typecheck
npm run build
```
Expected: `db:generate` writes `src/generated/prisma`; `typecheck` exits 0; `build` prints "Compiled successfully" and a route table including `/`, `/signin`, `/api/auth/[...nextauth]`.

- [ ] **Step 6: Verify the test runner works with a trivial unit test**

Create `src/test/smoke.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("test runner", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm run test:unit`
Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: fold in blueprint modules, add test + mapbox tooling"
```

---

### Task 2: Fleet schema — Depot, Vehicle, PositionPing

**Files:**
- Modify: `prisma/schema.prisma` (append models + enums)

**Interfaces:**
- Consumes: the `db-postgres` schema from Task 1 (generator + datasource + Auth.js models).
- Produces: Prisma models `Depot`, `Vehicle`, `PositionPing` and enums `VehicleStatus` (`idle`/`en_route`/`offline`), `PositionSource` (`simulation`/`telematics`). `Vehicle` carries denormalized current position: `lat`, `lng`, `heading`, `speed`, `positionUpdatedAt` (all nullable).

- [ ] **Step 1: Append the fleet models to the schema**

Add to the end of `prisma/schema.prisma`:

```prisma
enum VehicleStatus {
  idle
  en_route
  offline
}

enum PositionSource {
  simulation
  telematics
}

model Depot {
  id        String    @id @default(cuid())
  name      String
  lat       Float
  lng       Float
  vehicles  Vehicle[]
  createdAt DateTime  @default(now())
}

model Vehicle {
  id       String        @id @default(cuid())
  label    String
  type     String        @default("van")
  capacity Int           @default(0)
  status   VehicleStatus @default(idle)
  depotId  String?
  depot    Depot?        @relation(fields: [depotId], references: [id])

  // Denormalized current position, projected from the latest PositionPing.
  lat               Float?
  lng               Float?
  heading           Float?
  speed             Float?
  positionUpdatedAt DateTime?

  pings     PositionPing[]
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt
}

model PositionPing {
  id        String         @id @default(cuid())
  vehicleId String
  vehicle   Vehicle        @relation(fields: [vehicleId], references: [id], onDelete: Cascade)
  lat       Float
  lng       Float
  heading   Float
  speed     Float
  source    PositionSource @default(simulation)
  timestamp DateTime       @default(now())

  @@index([vehicleId, timestamp])
}
```

- [ ] **Step 2: Create and apply the migration**

Run: `npm run db:migrate -- --name fleet_models`
Expected: a migration is created under `prisma/migrations/`, applied to the local db, and the client regenerates. If prompted for a name non-interactively, the `--name` flag supplies it.

- [ ] **Step 3: Verify the client exposes the new models**

Create `src/fleet/schema.int.test.ts`:

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";

describe("fleet schema", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a depot, a vehicle, and a ping", async () => {
    const depot = await prisma.depot.create({
      data: { name: "Test Depot", lat: 51.5, lng: -0.12 },
    });
    const vehicle = await prisma.vehicle.create({
      data: { label: "V1", depotId: depot.id },
    });
    const ping = await prisma.positionPing.create({
      data: { vehicleId: vehicle.id, lat: 51.5, lng: -0.12, heading: 90, speed: 8 },
    });

    expect(vehicle.status).toBe("idle");
    expect(ping.source).toBe("simulation");

    await prisma.positionPing.deleteMany({ where: { vehicleId: vehicle.id } });
    await prisma.vehicle.delete({ where: { id: vehicle.id } });
    await prisma.depot.delete({ where: { id: depot.id } });
  });
});
```

- [ ] **Step 4: Run the integration test**

Run: `npx vitest run src/fleet/schema.int.test.ts`
Expected: 1 passed. (Requires `docker compose up -d` + migration applied.)

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/fleet/schema.int.test.ts
git commit -m "feat(fleet): add Depot, Vehicle, PositionPing models"
```

---

### Task 3: The PositionPing contract (validation)

**Files:**
- Create: `src/fleet/ingest/contract.ts`
- Test: `src/fleet/ingest/contract.test.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces: `positionPingInput` (a Zod schema) and `type PositionPingInput`. This is the single normalized shape every position source (simulator, telematics) must produce. Fields: `vehicleId: string`, `lat: number [-90,90]`, `lng: number [-180,180]`, `heading: number [0,360]`, `speed: number >=0`, `source: "simulation" | "telematics"` (default `"simulation"`), `timestamp?: Date`.

- [ ] **Step 1: Write the failing test**

Create `src/fleet/ingest/contract.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { positionPingInput } from "./contract";

describe("positionPingInput", () => {
  const base = { vehicleId: "v1", lat: 51.5, lng: -0.12, heading: 90, speed: 8 };

  it("accepts a valid ping and defaults source to simulation", () => {
    const parsed = positionPingInput.parse(base);
    expect(parsed.source).toBe("simulation");
    expect(parsed.vehicleId).toBe("v1");
  });

  it("rejects out-of-range latitude", () => {
    expect(() => positionPingInput.parse({ ...base, lat: 200 })).toThrow();
  });

  it("rejects a heading over 360", () => {
    expect(() => positionPingInput.parse({ ...base, heading: 400 })).toThrow();
  });

  it("rejects a missing vehicleId", () => {
    const { vehicleId: _omit, ...rest } = base;
    void _omit;
    expect(() => positionPingInput.parse(rest)).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/fleet/ingest/contract.test.ts`
Expected: FAIL — cannot find module `./contract`.

- [ ] **Step 3: Write the contract**

Create `src/fleet/ingest/contract.ts`:

```typescript
import { z } from "zod";

/**
 * The normalized ingestion contract. Every position source — the simulator
 * today, a telematics adapter later — must produce this shape. Nothing above
 * `src/fleet/ingest` should reference any source directly.
 */
export const positionPingInput = z.object({
  vehicleId: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  heading: z.number().min(0).max(360),
  speed: z.number().min(0),
  source: z.enum(["simulation", "telematics"]).default("simulation"),
  timestamp: z.coerce.date().optional(),
});

export type PositionPingInput = z.infer<typeof positionPingInput>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/fleet/ingest/contract.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/fleet/ingest/contract.ts src/fleet/ingest/contract.test.ts
git commit -m "feat(ingest): add normalized PositionPing contract"
```

---

### Task 4: Ingest — write ping, project current position, notify

**Files:**
- Create: `src/fleet/ingest/ingest.ts`
- Test: `src/fleet/ingest/ingest.int.test.ts`

**Interfaces:**
- Consumes: `@/lib/db` (`prisma`), `positionPingInput`/`PositionPingInput` from Task 3.
- Produces: `async function ingestPing(input: PositionPingInput): Promise<{ id: string }>`. Side effects: creates a `PositionPing` row; updates the vehicle's denormalized `lat`/`lng`/`heading`/`speed`/`positionUpdatedAt`; emits `NOTIFY vehicle_position` with JSON `{ vehicleId, lat, lng, heading, speed, timestamp }`.

- [ ] **Step 1: Write the failing test**

Create `src/fleet/ingest/ingest.int.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { ingestPing } from "./ingest";

let vehicleId: string;

beforeAll(async () => {
  const v = await prisma.vehicle.create({ data: { label: "ingest-test" } });
  vehicleId = v.id;
});

afterAll(async () => {
  await prisma.positionPing.deleteMany({ where: { vehicleId } });
  await prisma.vehicle.delete({ where: { id: vehicleId } });
  await prisma.$disconnect();
});

describe("ingestPing", () => {
  it("writes a ping and projects the vehicle's current position", async () => {
    await ingestPing({
      vehicleId,
      lat: 51.51,
      lng: -0.13,
      heading: 180,
      speed: 10,
      source: "simulation",
    });

    const pings = await prisma.positionPing.findMany({ where: { vehicleId } });
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });

    expect(pings).toHaveLength(1);
    expect(vehicle.lat).toBeCloseTo(51.51);
    expect(vehicle.heading).toBe(180);
    expect(vehicle.positionUpdatedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/fleet/ingest/ingest.int.test.ts`
Expected: FAIL — cannot find module `./ingest`.

- [ ] **Step 3: Write the ingest function**

Create `src/fleet/ingest/ingest.ts`:

```typescript
import { prisma } from "@/lib/db";
import { positionPingInput, type PositionPingInput } from "./contract";

/**
 * The single entry point for position data. Validates against the contract,
 * appends a ping, projects the vehicle's current position, and notifies
 * realtime subscribers via Postgres LISTEN/NOTIFY.
 */
export async function ingestPing(
  input: PositionPingInput,
): Promise<{ id: string }> {
  const p = positionPingInput.parse(input);
  const timestamp = p.timestamp ?? new Date();

  const ping = await prisma.positionPing.create({
    data: {
      vehicleId: p.vehicleId,
      lat: p.lat,
      lng: p.lng,
      heading: p.heading,
      speed: p.speed,
      source: p.source,
      timestamp,
    },
  });

  await prisma.vehicle.update({
    where: { id: p.vehicleId },
    data: {
      lat: p.lat,
      lng: p.lng,
      heading: p.heading,
      speed: p.speed,
      positionUpdatedAt: timestamp,
    },
  });

  const payload = JSON.stringify({
    vehicleId: p.vehicleId,
    lat: p.lat,
    lng: p.lng,
    heading: p.heading,
    speed: p.speed,
    timestamp,
  });
  // pg_notify's channel must be a literal; the payload is bound as a parameter.
  await prisma.$executeRawUnsafe("SELECT pg_notify('vehicle_position', $1)", payload);

  return { id: ping.id };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/fleet/ingest/ingest.int.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/fleet/ingest/ingest.ts src/fleet/ingest/ingest.int.test.ts
git commit -m "feat(ingest): write ping, project position, notify"
```

---

### Task 5: Fleet registry — create and list

**Files:**
- Create: `src/fleet/registry/vehicles.ts`
- Test: `src/fleet/registry/vehicles.int.test.ts`

**Interfaces:**
- Consumes: `@/lib/db` (`prisma`).
- Produces:
  - `async function createDepot(input: { name: string; lat: number; lng: number }): Promise<Depot>`
  - `async function createVehicle(input: { label: string; type?: string; capacity?: number; depotId?: string }): Promise<Vehicle>`
  - `async function listVehicles(): Promise<VehicleSummary[]>` where `type VehicleSummary = { id: string; label: string; status: string; lat: number | null; lng: number | null; heading: number | null; speed: number | null }`.

- [ ] **Step 1: Write the failing test**

Create `src/fleet/registry/vehicles.int.test.ts`:

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { createDepot, createVehicle, listVehicles } from "./vehicles";

const created: string[] = [];

afterAll(async () => {
  await prisma.vehicle.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("fleet registry", () => {
  it("creates a vehicle and returns it in the summary list", async () => {
    const depot = await createDepot({ name: "Depot A", lat: 51.5, lng: -0.1 });
    const vehicle = await createVehicle({ label: "Van 7", depotId: depot.id });
    created.push(vehicle.id);

    const summaries = await listVehicles();
    const found = summaries.find((v) => v.id === vehicle.id);

    expect(found).toBeDefined();
    expect(found?.label).toBe("Van 7");
    expect(found?.status).toBe("idle");

    await prisma.depot.delete({ where: { id: depot.id } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/fleet/registry/vehicles.int.test.ts`
Expected: FAIL — cannot find module `./vehicles`.

- [ ] **Step 3: Write the registry**

Create `src/fleet/registry/vehicles.ts`:

```typescript
import { prisma } from "@/lib/db";

export type VehicleSummary = {
  id: string;
  label: string;
  status: string;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  speed: number | null;
};

export async function createDepot(input: {
  name: string;
  lat: number;
  lng: number;
}) {
  return prisma.depot.create({ data: input });
}

export async function createVehicle(input: {
  label: string;
  type?: string;
  capacity?: number;
  depotId?: string;
}) {
  return prisma.vehicle.create({ data: input });
}

export async function listVehicles(): Promise<VehicleSummary[]> {
  const vehicles = await prisma.vehicle.findMany({ orderBy: { label: "asc" } });
  return vehicles.map((v) => ({
    id: v.id,
    label: v.label,
    status: v.status,
    lat: v.lat,
    lng: v.lng,
    heading: v.heading,
    speed: v.speed,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/fleet/registry/vehicles.int.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/fleet/registry/vehicles.ts src/fleet/registry/vehicles.int.test.ts
git commit -m "feat(fleet): vehicle + depot registry"
```

---

### Task 6: Ingest HTTP route

**Files:**
- Create: `src/app/api/ingest/route.ts`
- Test: `src/app/api/ingest/route.int.test.ts`

**Interfaces:**
- Consumes: `ingestPing` (Task 4), `positionPingInput` (Task 3).
- Produces: `POST /api/ingest` — validates the body against the contract, returns `400` + flattened errors on failure, otherwise calls `ingestPing` and returns `{ id }` with `201`.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/ingest/route.int.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/api/ingest/route.int.test.ts`
Expected: FAIL — cannot find module `./route`.

- [ ] **Step 3: Write the route**

Create `src/app/api/ingest/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { positionPingInput } from "@/fleet/ingest/contract";
import { ingestPing } from "@/fleet/ingest/ingest";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = positionPingInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { id } = await ingestPing(parsed.data);
  return NextResponse.json({ id }, { status: 201 });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/api/ingest/route.int.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ingest/route.ts src/app/api/ingest/route.int.test.ts
git commit -m "feat(ingest): POST /api/ingest route"
```

---

### Task 7: Realtime SSE stream over LISTEN/NOTIFY

**Files:**
- Create: `src/realtime/listen.ts`
- Create: `src/app/api/stream/route.ts`
- Test: `src/realtime/listen.int.test.ts`

**Interfaces:**
- Consumes: `pg` (`Client`), `ingestPing` (Task 4, in the test only).
- Produces:
  - `src/realtime/listen.ts`: `function subscribe(channel: string, onPayload: (payload: string) => void): Promise<() => Promise<void>>` — opens a dedicated `pg` client, `LISTEN`s on `channel`, invokes `onPayload` per notification, and resolves to an async unsubscribe/cleanup function.
  - `GET /api/stream`: an SSE response (`text/event-stream`) that emits `event: vehicle_position\ndata: <payload>\n\n` for each notification, plus a heartbeat comment every 15s, and cleans up its `pg` client on cancel.

- [ ] **Step 1: Write the failing test**

Create `src/realtime/listen.int.test.ts`:

```typescript
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

    expect(received.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(received[0]);
    expect(parsed.vehicleId).toBe(vehicleId);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/realtime/listen.int.test.ts`
Expected: FAIL — cannot find module `./listen`.

- [ ] **Step 3: Write the LISTEN helper**

Create `src/realtime/listen.ts`:

```typescript
import { Client } from "pg";

/**
 * Open a dedicated Postgres connection that LISTENs on `channel` and calls
 * `onPayload` for each notification. Returns a cleanup function that stops
 * listening and closes the connection.
 *
 * A dedicated client (not the Prisma pool) is required: LISTEN binds to a
 * single physical connection for the life of the subscription.
 */
export async function subscribe(
  channel: string,
  onPayload: (payload: string) => void,
): Promise<() => Promise<void>> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  client.on("notification", (msg) => {
    if (msg.channel === channel && msg.payload) onPayload(msg.payload);
  });
  await client.query(`LISTEN ${channel}`);

  return async () => {
    try {
      await client.query(`UNLISTEN ${channel}`);
    } finally {
      await client.end();
    }
  };
}
```

Note: `channel` is interpolated into the SQL — it is a fixed internal constant (`vehicle_position`), never user input, so this is safe. Do not pass caller-controlled strings here.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/realtime/listen.int.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Write the SSE route (uses the helper)**

Create `src/app/api/stream/route.ts`:

```typescript
import { subscribe } from "@/realtime/listen";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  let cleanup: (() => Promise<void>) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      cleanup = await subscribe("vehicle_position", (payload) => {
        controller.enqueue(
          encoder.encode(`event: vehicle_position\ndata: ${payload}\n\n`),
        );
      });
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 15000);
    },
    async cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (cleanup) await cleanup();
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

- [ ] **Step 6: Verify the route compiles and typechecks**

Run: `npm run typecheck`
Expected: exit 0. (The SSE stream itself is exercised end-to-end manually in Task 9.)

- [ ] **Step 7: Commit**

```bash
git add src/realtime/listen.ts src/app/api/stream/route.ts src/realtime/listen.int.test.ts
git commit -m "feat(realtime): SSE stream over Postgres LISTEN/NOTIFY"
```

---

### Task 8: Live Mapbox map

**Files:**
- Create: `src/console/map/markers.ts`
- Create: `src/console/map/FleetMap.tsx`
- Create: `src/app/(app)/dashboard/page.tsx`
- Test: `src/console/map/markers.test.ts`

**Interfaces:**
- Consumes: `listVehicles`/`VehicleSummary` (Task 5), `mapbox-gl`, the SSE `/api/stream` endpoint (Task 7).
- Produces:
  - `src/console/map/markers.ts`: pure helpers —
    - `type VehiclePosition = { vehicleId: string; lat: number; lng: number; heading: number }`
    - `function parsePositionEvent(data: string): VehiclePosition | null` (safe JSON parse + shape guard)
    - `function toGeoJson(vehicles: VehiclePosition[]): GeoJSON.FeatureCollection<GeoJSON.Point>` (for map source data)
  - `FleetMap` (client component) rendering the map + live updates.
  - `/dashboard` server page that loads initial vehicles and renders `FleetMap`.

- [ ] **Step 1: Write the failing test for the pure helpers**

Create `src/console/map/markers.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parsePositionEvent, toGeoJson } from "./markers";

describe("parsePositionEvent", () => {
  it("parses a valid event payload", () => {
    const data = JSON.stringify({ vehicleId: "v1", lat: 51.5, lng: -0.1, heading: 90, speed: 4 });
    expect(parsePositionEvent(data)).toEqual({ vehicleId: "v1", lat: 51.5, lng: -0.1, heading: 90 });
  });

  it("returns null for malformed JSON", () => {
    expect(parsePositionEvent("{not json")).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(parsePositionEvent(JSON.stringify({ vehicleId: "v1" }))).toBeNull();
  });
});

describe("toGeoJson", () => {
  it("maps vehicles to point features carrying id and heading", () => {
    const fc = toGeoJson([{ vehicleId: "v1", lat: 51.5, lng: -0.1, heading: 30 }]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features[0].geometry.coordinates).toEqual([-0.1, 51.5]);
    expect(fc.features[0].properties?.heading).toBe(30);
    expect(fc.features[0].properties?.vehicleId).toBe("v1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/console/map/markers.test.ts`
Expected: FAIL — cannot find module `./markers`.

- [ ] **Step 3: Write the pure helpers**

Create `src/console/map/markers.ts`:

```typescript
export type VehiclePosition = {
  vehicleId: string;
  lat: number;
  lng: number;
  heading: number;
};

export function parsePositionEvent(data: string): VehiclePosition | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.vehicleId !== "string" ||
    typeof o.lat !== "number" ||
    typeof o.lng !== "number" ||
    typeof o.heading !== "number"
  ) {
    return null;
  }
  return { vehicleId: o.vehicleId, lat: o.lat, lng: o.lng, heading: o.heading };
}

export function toGeoJson(
  vehicles: VehiclePosition[],
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: vehicles.map((v) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [v.lng, v.lat] },
      properties: { vehicleId: v.vehicleId, heading: v.heading },
    })),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/console/map/markers.test.ts`
Expected: 3 passed. (`GeoJSON` types come from `@types/mapbox-gl`'s dependency `@types/geojson`; if `tsc` cannot find them, run `npm install -D @types/geojson`.)

- [ ] **Step 5: Write the map client component**

Create `src/console/map/FleetMap.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  parsePositionEvent,
  toGeoJson,
  type VehiclePosition,
} from "./markers";
import type { VehicleSummary } from "@/fleet/registry/vehicles";

const SOURCE_ID = "vehicles";

function initialPositions(vehicles: VehicleSummary[]): VehiclePosition[] {
  return vehicles
    .filter((v) => v.lat !== null && v.lng !== null)
    .map((v) => ({
      vehicleId: v.id,
      lat: v.lat as number,
      lng: v.lng as number,
      heading: v.heading ?? 0,
    }));
}

export function FleetMap({ vehicles }: { vehicles: VehicleSummary[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const positions = useRef<Map<string, VehiclePosition>>(
    new Map(initialPositions(vehicles).map((p) => [p.vehicleId, p])),
  );

  useEffect(() => {
    if (!containerRef.current) return;
    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

    const first = [...positions.current.values()][0];
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: first ? [first.lng, first.lat] : [-0.12, 51.5],
      zoom: 11,
    });

    const render = () => {
      const src = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      if (src) src.setData(toGeoJson([...positions.current.values()]));
    };

    map.on("load", () => {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: toGeoJson([...positions.current.values()]),
      });
      map.addLayer({
        id: "vehicles-arrows",
        type: "symbol",
        source: SOURCE_ID,
        layout: {
          "icon-image": "triangle-15",
          "icon-rotate": ["get", "heading"],
          "icon-allow-overlap": true,
          "icon-size": 1.4,
        },
      });
      render();
    });

    const es = new EventSource("/api/stream");
    es.addEventListener("vehicle_position", (e) => {
      const pos = parsePositionEvent((e as MessageEvent).data);
      if (!pos) return;
      positions.current.set(pos.vehicleId, pos);
      render();
    });

    return () => {
      es.close();
      map.remove();
    };
  }, []);

  return <div ref={containerRef} className="h-screen w-full" />;
}
```

- [ ] **Step 6: Write the dashboard page**

Create `src/app/(app)/dashboard/page.tsx`:

```tsx
import { listVehicles } from "@/fleet/registry/vehicles";
import { FleetMap } from "@/console/map/FleetMap";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const vehicles = await listVehicles();
  return <FleetMap vehicles={vehicles} />;
}
```

- [ ] **Step 7: Verify typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: exit 0; the route table now includes `/dashboard`.

- [ ] **Step 8: Commit**

```bash
git add src/console src/app/\(app\)/dashboard/page.tsx
git commit -m "feat(console): live Mapbox fleet map + dashboard"
```

---

### Task 9: Demo mover — prove liveness end to end

**Files:**
- Create: `scripts/demo-mover.ts`
- Modify: `README.md` (add a "Run the live demo" section)

**Interfaces:**
- Consumes: `createDepot`/`createVehicle`/`listVehicles` (Task 5), the `POST /api/ingest` route (Task 6).
- Produces: a runnable script that ensures at least one vehicle exists, then drives it in a slow circle by POSTing pings to `/api/ingest`, so the `/dashboard` map visibly moves.

- [ ] **Step 1: Write the mover script**

Create `scripts/demo-mover.ts`:

```typescript
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { createDepot, createVehicle, listVehicles } from "../src/fleet/registry/vehicles";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const CENTER = { lat: 51.5, lng: -0.12 };
const RADIUS = 0.02; // ~2 km

async function ensureVehicle(): Promise<string> {
  const existing = await listVehicles();
  if (existing.length > 0) return existing[0].id;
  const depot = await createDepot({ name: "Demo Depot", ...CENTER });
  const vehicle = await createVehicle({ label: "Demo Van", depotId: depot.id });
  return vehicle.id;
}

async function main() {
  const vehicleId = await ensureVehicle();
  console.log(`Moving vehicle ${vehicleId}. Open ${APP_URL}/dashboard`);

  let angle = 0;
  setInterval(async () => {
    angle = (angle + 5) % 360;
    const rad = (angle * Math.PI) / 180;
    const lat = CENTER.lat + RADIUS * Math.sin(rad);
    const lng = CENTER.lng + RADIUS * Math.cos(rad);
    const heading = (angle + 90) % 360; // tangent to the circle

    const res = await fetch(`${APP_URL}/api/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vehicleId, lat, lng, heading, speed: 8 }),
    });
    if (!res.ok) console.error("ingest failed", res.status, await res.text());
  }, 1000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the full stack and verify the map moves**

In three terminals (Postgres already up via `docker compose up -d`):

```bash
# 1. dev server
npm run dev
# 2. the mover (after the server is listening)
npx tsx scripts/demo-mover.ts
```

Open `http://localhost:3000/dashboard`.
Expected: a dark Mapbox map centered on London with one arrow marker moving smoothly around a circle, rotating to face its direction of travel, updating about once per second **without any page refresh**. This exercises the whole chain: `ingest → NOTIFY → LISTEN → SSE → map`.

- [ ] **Step 3: Document the demo in the README**

Append to `README.md`:

```markdown
## Run the live demo

1. `docker compose up -d` — start Postgres
2. `npm run db:migrate` — apply the schema
3. Fill `NEXT_PUBLIC_MAPBOX_TOKEN` in `.env.local`
4. `npm run dev` — start the app
5. `npx tsx scripts/demo-mover.ts` — drive a simulated vehicle
6. Open http://localhost:3000/dashboard — watch it move in real time

This proves the liveness chain end to end: `POST /api/ingest` → Postgres
`NOTIFY` → SSE `/api/stream` → the Mapbox map, with no page refresh.
```

- [ ] **Step 4: Commit**

```bash
git add scripts/demo-mover.ts README.md
git commit -m "feat: demo mover proving the live ingest->SSE->map chain"
```

- [ ] **Step 5: Push and confirm CI is green**

```bash
git push
```
Expected: the `ci` workflow runs `prisma generate → eslint → tsc → build` and passes. (Integration tests are not run in CI in this plan — they require a provisioned Postgres service; wiring a CI Postgres is a Plan 4 hardening item.)

---

## What Plan 1 delivers

A running helm app where a (simulated) vehicle moves live on a Mapbox map, driven entirely through the `PositionPing` contract and the SSE/`LISTEN`/`NOTIFY` realtime path — the liveness half of the console, independently demoable. **Deferred to later plans:** deliveries + geocoding + Optimization-v1 routing (Plan 2); the persistent simulation worker + arrival→status lifecycle + full assign/optimize/reassign dispatch UX (Plan 3); SSE reconnect, `DispatchEvent` audit trail, seed dataset, CI Postgres, release (Plan 4).

## Self-review notes

- **Spec coverage (M0–M2):** M0 scaffold → Task 1; `PositionPing` contract + fleet state → Tasks 2–5; live map + SSE over `LISTEN/NOTIFY` → Tasks 6–8; end-to-end liveness proof → Task 9. Auth/Sentry/CI arrive via the Task 1 overlay. Routing/deliveries/simulation are correctly out of scope for Plan 1.
- **Contract boundary:** only `src/fleet/ingest` and the mover produce pings; the map/registry/SSE consume the normalized shape — no consumer references a source. ✔
- **Type consistency:** `PositionPingInput` (Task 3) flows into `ingestPing` (Task 4), the ingest route (Task 6), and the mover (Task 9); `VehicleSummary` (Task 5) flows into `FleetMap` (Task 8); `VehiclePosition` + `parsePositionEvent`/`toGeoJson` names match between Tasks 8's helper and component. ✔
