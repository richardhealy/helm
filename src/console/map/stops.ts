export type StopView = {
  id: string;
  lat: number;
  lng: number;
  status: string;
};

export function stopsToGeoJson(
  stops: StopView[],
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: stops.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      properties: { id: s.id, status: s.status },
    })),
  };
}
