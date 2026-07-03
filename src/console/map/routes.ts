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

/**
 * Bounding box of all route geometries as `[[minLng,minLat],[maxLng,maxLat]]`,
 * or null when there are no coordinates. Used to fit the map to the route so
 * the depot, every stop, and the vehicle stay on screen.
 */
export function routeBounds(
  routes: RouteView[],
): [[number, number], [number, number]] | null {
  const coords = routes.flatMap((r) => r.geometry.coordinates);
  if (coords.length === 0) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}
