# Changelog

## 2026-11-09

### Fixed

- `POST /api/ingest` with a `vehicleId` that matches no vehicle now answers
  404 with `Vehicle <id> not found`. It used to fail with a 500, because
  Postgres refused the ping insert on its foreign key (Prisma P2003) and
  nothing caught it, so a telematics feed sending a stale or mistyped id got a
  server error. The ping is not stored, no vehicle position changes and no
  `vehicle_position` notification is sent (`src/fleet/ingest/ingest.ts`).

### Changed

- `VehicleNotFoundError` moved to `src/fleet/registry/vehicles.ts` and the
  foreign-key check to `isForeignKeyViolation` in `src/lib/db.ts`, so ingest
  and assign share them. `src/deliveries/orders/deliveries.ts` still exports
  `VehicleNotFoundError`.

## 2026-11-08

### Fixed

- `POST /api/deliveries/:id/assign` with a `vehicleId` that matches no vehicle
  now answers 404 with `Vehicle <id> not found`. It used to fail with a 500,
  because the foreign-key error Postgres raised on the update (Prisma P2003)
  was not caught. The stop is left exactly as it was and no `assigned` event
  is logged. A finished stop still answers 409 whatever vehicle is named, and
  an unknown stop still answers 404 (`src/deliveries/orders/deliveries.ts`).

## 2026-10-06

### Fixed

- The simulator no longer delivers stops that were taken off a van after it set
  off. If the dispatcher unassigned an en-route stop or moved it to another
  van, the original van still marked it delivered when it drove past. An
  unassigned stop then disappeared from the board with no vehicle, and a
  reassigned stop showed as delivered by the wrong van. Arrival now only
  delivers a stop that still belongs to that van (`src/simulation/driver.ts`).
- When a van departs, only the stops on its route go en route. A stop assigned
  after the route was optimized now stays `assigned` instead of sitting
  `en_route` with no leg that could ever reach it.
- Delivered and failed stops can no longer be unassigned or reassigned. Before,
  unassigning a delivered stop put it back in the pool with `completedAt`
  still set. `POST /api/deliveries/:id/assign` and `/unassign` now answer 409
  for a finished stop and 404 for an unknown delivery (that used to be a 500),
  and the console no longer shows Unassign on finished stops.
