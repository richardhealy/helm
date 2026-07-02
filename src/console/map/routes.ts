export type RouteView = {
  vehicleId: string;
  geometry: GeoJSON.LineString;
};

export function routesToGeoJson(
  routes: RouteView[],
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: "FeatureCollection",
    features: routes.map((r) => ({
      type: "Feature",
      geometry: r.geometry,
      properties: { vehicleId: r.vehicleId },
    })),
  };
}
