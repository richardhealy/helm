# helm

A fleet dispatch console on Mapbox. Dispatchers watch a live map of vehicles,
batch deliveries onto a van, and the system computes the optimal stop order,
draws the route with ETAs, and tracks every stop to completion — driven by a
simulation engine that stands in for real telematics behind a swap-in
`PositionPing` ingest contract.

## What it does

- **Live map** — Mapbox GL board that fits to the active routes; vehicles move
  in real time over SSE (Postgres `LISTEN/NOTIFY`).
- **Delivery intake** — address → coordinates via Mapbox Geocoding.
- **Optimized routing** — Mapbox Optimization v1: ordered stops, drawn route
  geometry, per-leg ETAs.
- **Simulation engine** — a persistent worker glides vehicles along their
  routes and flips stops to delivered on arrival.
- **Dispatch console** — add/assign/reassign/optimize, a status-lamp roster,
  and a live audit-trail activity feed.

See [`spec.md`](./spec.md) for the full design and [`docs/DEPLOY.md`](./docs/DEPLOY.md)
to deploy.

## Getting started

```bash
cp .env.example .env.local        # then fill in secrets
docker compose up -d              # local Postgres (if the db module is enabled)
npx prisma migrate dev            # create the schema
npm run dev                       # http://localhost:3000
```

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Typecheck |
| `npx prisma generate` | Regenerate the Prisma client |
| `npx prisma migrate dev` | Apply migrations locally |

## Layout

- `src/app` — App Router routes
- `src/lib` — shared server/client utilities (`db`, `env`, `providers`, …)
- `prisma` — schema and migrations

## Run the live demo

1. `docker compose up -d` — start Postgres
2. `npm run db:migrate` — apply the schema
3. Fill `NEXT_PUBLIC_MAPBOX_TOKEN` in `.env.local`
4. `npm run dev` — start the app
5. `npx tsx scripts/demo-mover.ts` — drive a simulated vehicle
6. Open http://localhost:3000/dashboard — watch it move in real time

This proves the liveness chain end to end: `POST /api/ingest` → Postgres
`NOTIFY` → SSE `/api/stream` → the Mapbox map, with no page refresh.

## Run the routing demo

With the app running (`npm run dev`) and Postgres up:

```bash
npx tsx scripts/demo-deliveries.ts
```

This geocodes five London addresses (biased to GB so ambiguous names resolve
in London), assigns them to the demo vehicle, and runs Mapbox Optimization v1 —
the dashboard then draws the optimized route through the ordered stops.
Re-running `optimize` after adding/removing stops redraws the route live over
SSE (`route_updated`).

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

## Run a full fleet demo

To see several vehicles working at once (instead of the single-van
`demo-deliveries`):

```bash
npx tsx scripts/demo-fleet.ts          # 3 vans, each an optimized route across London
SIM_LOOP=true npx tsx scripts/simulator.ts   # drives them, and re-dispatches on finish
```

`SIM_LOOP=true` re-dispatches each van when it completes its route, so the fleet
keeps moving indefinitely (handy for a live demo). Without it, vans go idle once
delivered — as a real fleet would.
