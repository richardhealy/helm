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
