# Changelog

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
