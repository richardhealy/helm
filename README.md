# Project

Scaffolded with `blueprint` / `setup-project`. See [`spec.md`](./spec.md) for the
full design.

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
