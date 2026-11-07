# Progress

Last updated: 2026-10-06

## Where it stands

The spec's milestones M0 to M7 are built and on `main`, with one gap (sign-in
does not gate the console, see below). That covers the fleet registry and
`PositionPing` ingest contract, the live Mapbox map over SSE, delivery intake
with geocoding, Optimization v1 routing with persisted legs and ETAs, the
simulation worker, the dispatch console, the `DispatchEvent` audit trail, a
seed dataset and CI against a Postgres service. Nearest-depot fleet dispatch
(`POST /api/dispatch/fleet`, the "Dispatch fleet" button) sits on top of that.

The milestone table in `spec.md` still shows every row as "Not started". This
file is the current record.

## Tests

`npm test` runs 69 tests in 36 files. Without `MAPBOX_TOKEN`, 6 live-Mapbox
tests in 5 files are skipped, which is how CI runs unless the secret is set.
Integration tests need Postgres (see the README) and run one file at a time.

## Known issues

- **Optimizing a van that is already on the road drops its en-route stops.**
  `optimizeRouteForVehicle` (`src/routing/routes/routes.ts`) only picks up
  `assigned` stops and replaces the van's route, so stops already `en_route`
  lose their route leg and are never delivered, and the van starts again from
  its depot. Found by reading the code; there is no test for it yet. The fix
  needs a design choice: refuse to re-optimize mid-route, or re-optimize from
  the van's current position.
- **The console and API routes are not behind sign-in.** Auth.js, the Google
  provider and `/signin` are set up, but no page or route checks the session.
  The spec says Google auth gates the console.
- **Route geometry is fixed when a route is optimized.** Taking a stop off a
  moving van no longer corrupts its status (fixed 2026-10-06), but the van
  still drives its old line past that stop until the route is re-optimized,
  which runs into the first issue.
- **Assigning to an unknown vehicle id returns a 500** (Prisma foreign-key
  error P2003) rather than a 404.

## Recently done

- 2026-10-06: the simulator only delivers stops that still belong to the van,
  departure only marks the route's own stops en route, and delivered or failed
  stops can't be unassigned or reassigned (409 from the API, no Unassign
  button in the console). 11 new tests.

## Next

1. Decide how re-optimizing a moving van should work, then fix the first known
   issue with a test.
2. Gate the dashboard and the dispatch API routes behind sign-in.
3. Stretch goals in `spec.md`. Fleet-wide VRP on Optimization v2 was tried
   earlier and the Mapbox account returned forbidden, so
   `assignNearest` in `src/routing/fleet/assign.ts` is the swap point for now.
