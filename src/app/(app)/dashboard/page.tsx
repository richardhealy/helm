import { listVehicles } from "@/fleet/registry/vehicles";
import { getActiveRoute } from "@/routing/routes/routes";
import { listRouteStops } from "@/routing/routes/stops";
import { FleetMap } from "@/console/map/FleetMap";
import type { RouteView } from "@/console/map/routes";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const vehicles = await listVehicles();
  const routes: RouteView[] = [];
  for (const v of vehicles) {
    const route = await getActiveRoute(v.id);
    if (route) {
      routes.push({
        vehicleId: v.id,
        geometry: route.geometry as unknown as GeoJSON.LineString,
      });
    }
  }
  const stops = await listRouteStops();
  return <FleetMap vehicles={vehicles} routes={routes} stops={stops} />;
}
