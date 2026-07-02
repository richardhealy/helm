# helm

**One-liner:** Fleet dispatch console on Mapbox: watch a live fleet, batch deliveries onto a vehicle, and let the system compute the optimal stop order, draw the route with ETAs, and track every stop to completion — driven end-to-end by a simulation engine that stands in for real telematics behind a swap-in ingestion contract.

**Track:** Geospatial & real-time operations
**Type:** spec
**Stack:** Next.js 15 / React 19, TypeScript (ESM). Postgres via Prisma for fleet + delivery state. Mapbox GL JS (map), Mapbox Optimization v1 (stop ordering), Directions (leg geometry), Geocoding (address → coords). Server-Sent Events over Postgres `LISTEN/NOTIFY` for live push. A persistent simulation worker (Railway) drives vehicle movement. Google auth gates the console; Sentry for errors.

---

## Overview

The single problem `helm` isolates is the dispatcher's live control loop: turning a pile of unordered deliveries into optimized routes on a fleet you can watch move in real time — without any driver app or GPS hardware in the loop.

A dispatch console has two hard halves. The first is **routing**: given a vehicle and a set of stops, produce the best visiting order with honest ETAs, drawn on a map, re-optimized when the plan changes. The second is **liveness**: vehicles that actually move, stops that flip from *en-route* to *delivered* as trucks arrive, a map that updates without a refresh. Most demos fake one or fudge the other.

`helm` earns both. Routing runs on Mapbox Optimization v1 (single-vehicle TSP) with persisted route geometry and per-leg ETAs. Liveness comes from a **simulation engine**: a persistent worker that advances each vehicle along its assigned route geometry at a realistic speed, emits normalized position pings, and flips stop status on arrival. Crucially, the simulator publishes through the exact same `PositionPing` contract a real telematics feed would — so "simulated fleet" and "real fleet" are one interface swap apart, and nothing above the ingest layer knows the difference.

**Design rule:** everything above `fleet/ingest` consumes the normalized `PositionPing` contract. The simulator is one adapter; a telematics provider (Samsara, Geotab) is another. The console, routing, and realtime layers never learn which is feeding them.

---

## Users

- **Dispatcher** — the primary operator. Signs in with Google auth, watches the live fleet map, batches unassigned deliveries onto a vehicle, triggers optimization, and monitors each route to completion. Reassigns stops when plans change.
- **The simulation engine** — a non-human actor that stands in for the field: it moves vehicles along their routes, emits position pings on the normalized contract, and advances delivery status as vehicles arrive. Replaceable by a real telematics adapter without touching any consumer.
- **Out of scope as users (v1):** drivers (no driver app), customers (no public tracking page), back-office analysts (no analytics dashboards). The console is the only surface.

---

## Core features

- **Live fleet map:** Mapbox GL JS map showing every vehicle as a heading-aware marker, updating in real time over SSE. Click a vehicle to inspect its route, current stop, and ETA. Route lines overlaid with stop sequence markers; clustering at low zoom.
- **Delivery intake:** create deliveries by address; Mapbox Geocoding resolves each to coordinates. Deliveries land in an *unassigned* pool with an optional time window and service duration.
- **Assign & optimize:** the dispatcher selects unassigned stops and assigns them to a vehicle. The routing core calls Mapbox Optimization v1 to compute the optimal visiting order from the vehicle's depot, persists the ordered stops, route geometry, and per-leg ETAs, and draws the route on the map. Re-optimizes automatically when stops are added, removed, or reassigned.
- **Live progress tracking:** as the simulated vehicle moves, its position streams to the map and its ETA is recomputed against the route. On arrival at a stop, the stop flips *en-route → delivered* and the console reflects it without a refresh.
- **Reassignment:** move a stop from one vehicle to another; both affected routes re-optimize and redraw.
- **Swap-in ingestion contract:** all position data enters through a single normalized `PositionPing` contract. The simulation engine is the v1 adapter; a real telematics adapter can replace it with zero changes above the ingest boundary.

**Explicitly out (v1):** driver app; customer-facing tracking page; fleet-wide VRP / multi-vehicle assignment (single-vehicle optimization only); capacity/time-window *constraint solving* (time windows are captured and displayed, not enforced by the optimizer); historical analytics dashboards; real telematics integration (the adapter seam exists; no provider is wired).

### The dispatch workflow

1. **Intake.** Dispatcher enters delivery addresses; each is geocoded into the unassigned pool.
2. **Assign.** Dispatcher selects stops and drops them on a vehicle.
3. **Optimize.** Routing core → Mapbox Optimization v1 → ordered stops + geometry + per-leg ETAs, persisted as a `Route`.
4. **Dispatch.** Route goes *active*; the simulation engine begins advancing the vehicle along the geometry.
5. **Track.** Position pings stream to the map; stops flip to *delivered* on arrival; the route completes when its last stop is done.
6. **Adjust.** Adding/removing/reassigning a stop re-optimizes the affected route(s) live.

### The simulation engine (liveness)

A persistent worker running a fixed-interval tick loop (~1s). Each tick, for every active route, it advances the vehicle a distance along its route geometry proportional to a realistic speed, computes the new position + heading, and writes a `PositionPing` through the ingest contract. When a vehicle's advanced position reaches a stop's location (within an arrival threshold), the engine flips that stop *en-route → delivered*, timestamps it, and advances to the next leg; when the last stop completes, the route is marked *completed* and the vehicle returns to *idle*. Speed, tick rate, and arrival threshold are configurable. The engine is a pure consumer of persisted `Route` geometry and a pure producer of `PositionPing`s — it shares no code with the map or routing UI.

### Realtime push

Position and status changes are broadcast to connected consoles over **Server-Sent Events**. The bus is **Postgres `LISTEN/NOTIFY`**: writers (`fleet/ingest`, `deliveries`, `routing`) emit `NOTIFY` on channels (`vehicle_position`, `stop_status`, `route_updated`); the SSE endpoint holds a `LISTEN` connection and relays payloads to subscribed dispatchers. One-directional (the dispatcher observes; commands go over normal request handlers), so no WebSocket machinery is required.

---

## Data model

State lives in Postgres via Prisma. Core entities:

- **Depot** — a start/end anchor for optimization. Name, lat, lng.
- **Vehicle** — label, type, capacity, home `Depot`, status (`idle` / `en_route` / `offline`), and a denormalized current position (lat, lng, heading, speed, `updatedAt`) projected from the latest ping.
- **PositionPing** — the normalized ingestion contract and append-only track history: `vehicleId`, lat, lng, heading, speed, `timestamp`, `source` (`simulation` / `telematics`). Everything above `fleet/ingest` reads this shape only.
- **Delivery** (stop) — address, geocoded lat/lng, optional time window, service duration, status (`unassigned` / `assigned` / `en_route` / `delivered` / `failed`), nullable `vehicleId`, `sequence` (order within its route), `assignedAt`, `completedAt`, notes.
- **Route** — belongs to a `Vehicle`. Status (`draft` / `active` / `completed`), encoded geometry (GeoJSON/polyline), total distance, total duration, `optimizedAt`. Has ordered `RouteLeg`s.
- **RouteLeg** — belongs to a `Route`. From-stop → to-stop, distance, duration, computed ETA, leg geometry.
- **Dispatcher** — the operator, via Google auth. Owns nothing exclusive in v1 (single-tenant), but scopes sessions and audit.
- **DispatchEvent** — audit trail: assignment, optimize, reassign, arrival, completion, each with actor (dispatcher or `simulation`), payload, and timestamp — so the live board is explainable after the fact.

---

## Modules

Blueprint toggles for `helm`. Postgres holds fleet + delivery + route state; Google auth gates the dispatcher console; Sentry tracks errors; Railway hosts the persistent simulation worker and the SSE-backed web app (a long-running tick loop rules out a purely serverless target). No Stripe (not a paid SaaS in v1), no email, no analytics. Public for the portfolio showcase. Requires a `MAPBOX_TOKEN` env var (Optimization + Directions + Geocoding + GL JS) — an app secret, not a blueprint toggle.

```config
PROJECT_NAME=helm
GOOGLE_AUTH=true
STRIPE=false
EMAIL=false
SENTRY=true
ANALYTICS=false
DB=postgres
DEPLOY=railway
VISIBILITY=public
```

### Architecture

```
helm/
  fleet/
    registry/       # vehicles + depots CRUD
    positions/      # current-position projection, track history
    ingest/         # normalized PositionPing contract + adapters (sim today, telematics later)
  deliveries/
    orders/         # delivery/stop entities + status lifecycle
    geocode/        # address -> coords (Mapbox Geocoding)
  routing/
    optimize/       # Mapbox Optimization v1: assigned stops -> ordered route + ETAs
    directions/     # leg geometry + per-leg durations (Mapbox Directions)
    routes/         # persisted routes + legs, re-optimization triggers
  simulation/
    engine/         # tick loop: advance vehicles along geometry, emit PositionPings
    lifecycle/      # arrival detection -> flip stop status, complete route
  realtime/
    stream/         # SSE endpoint + Postgres LISTEN/NOTIFY bus
  console/
    map/            # Mapbox GL: heading-aware markers, route overlays, clustering
    dispatch/       # assign stops -> vehicle, trigger optimize, monitor, reassign
    inspect/        # vehicle + stop detail panels
  auth/             # Google auth (dispatcher login)
  worker/           # host process for the persistent simulation tick loop
```

---

## Best-in-class quality checklist

- [ ] Optimizing N stops on a vehicle returns a visiting order at least as good as input order and draws valid geometry with per-leg ETAs (tested on seeded stops).
- [ ] Adding/removing/reassigning a stop re-optimizes only the affected route(s) and redraws within one interaction.
- [ ] A simulated vehicle traverses its route geometry smoothly and its position reaches the SSE-connected map within ~1s of each tick.
- [ ] On arrival, a stop flips `en_route → delivered` exactly once, timestamped, and the route completes only after its last stop (tested on a seeded run).
- [ ] Every consumer above `fleet/ingest` reads only `PositionPing`; swapping the simulation adapter for a stub telematics adapter requires no changes above the ingest boundary (adversarially tested).
- [ ] Geocoding a batch of real addresses resolves to plausible coordinates; failures are surfaced, not silently dropped.
- [ ] SSE reconnects cleanly after a dropped connection without duplicating or losing position updates.
- [ ] Every assignment, optimization, arrival, and completion is recorded as a `DispatchEvent` with actor and timestamp; the board is explainable after the fact.

---

## Milestones & status

| #  | Milestone            | Outcome                                                                       | Status      |
|----|----------------------|-------------------------------------------------------------------------------|-------------|
| M0 | Scaffold             | Next.js + Prisma + Postgres, Google auth, Sentry, CI green                     | Not started |
| M1 | Fleet + ingest       | Vehicles/depots, `PositionPing` contract, current-position projection          | Not started |
| M2 | Live map + realtime  | Mapbox GL map, heading markers, SSE over `LISTEN/NOTIFY`, live position push    | Not started |
| M3 | Deliveries + geocode  | Delivery entities, status lifecycle, address → coords                          | Not started |
| M4 | Routing              | Optimization v1 ordering, persisted routes/legs/ETAs, route overlays           | Not started |
| M5 | Simulation           | Tick-loop worker, movement along geometry, arrival → status, route completion  | Not started |
| M6 | Dispatch workflow    | Assign/optimize/reassign UX, live re-optimization, inspect panels              | Not started |
| M7 | Polish + ship        | Reconnect handling, audit trail, seed dataset, README, release                 | Not started |

Status legend: Not started, In progress, Done, Blocked.

---

## Definition of done

1. A dispatcher signs in, enters delivery addresses, and sees them geocoded into the unassigned pool.
2. Assigning stops to a vehicle produces an optimized route (Optimization v1) with drawn geometry and per-leg ETAs, persisted and reloadable.
3. On dispatch, the simulated vehicle moves along the route on the live map, updating over SSE within ~1s per tick, with no manual refresh.
4. Stops flip to `delivered` on arrival exactly once and the route completes after the last stop; state survives reload.
5. Reassigning a stop re-optimizes and redraws the affected route(s) live.
6. Replacing the simulation adapter with a stub telematics adapter requires no change above `fleet/ingest` (proven by test).
7. Every assignment, optimization, arrival, and completion is auditable via `DispatchEvent`.

---

## Stretch goals

- **Fleet-wide VRP:** upgrade routing to Mapbox Optimization v2 — assign a batch of deliveries across multiple vehicles honoring capacity and time windows, then optimize each route.
- **Real telematics adapter:** wire a live provider (Samsara/Geotab) behind the `PositionPing` contract to run real and simulated fleets side by side.
- **Time-window enforcement:** feed captured time windows into the optimizer as constraints and flag at-risk stops before they slip.
- **Customer tracking page:** a public read-only ETA/live-map view per delivery, reusing the realtime layer.
- **Replay:** scrub the `PositionPing` + `DispatchEvent` history to replay a day's dispatch board as-of any moment.

---

## Relationship to the portfolio

`helm` is the geospatial, real-time operations member of the family. It shares the durable-worker discipline of `strategos` and `harbormaster` (a persistent tick loop instead of a sync loop) and the same normalized-contract-at-the-boundary pattern that lets an internal simulator and an external provider be one swap apart. It reuses `watchtower` for observability and Sentry for errors. Where `harbormaster` coordinates a fleet of agents and `conductor` executes single units of work, `helm` steers a fleet of vehicles across a map — the same coordination instincts applied to physical logistics.
