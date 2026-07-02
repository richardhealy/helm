import { listVehicles } from "@/fleet/registry/vehicles";
import { FleetMap } from "@/console/map/FleetMap";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const vehicles = await listVehicles();
  return <FleetMap vehicles={vehicles} />;
}
