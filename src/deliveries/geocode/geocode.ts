export type Proximity = { lat: number; lng: number };

/**
 * Bias options for forward geocoding. `country` (ISO 3166-1 alpha-2, e.g. "gb")
 * is the strong signal — it prevents wrong-country matches like resolving
 * "St Paul's Cathedral, London" to St. Pauls, North Carolina. `proximity`
 * refines ranking within that region.
 */
export type GeocodeBias = { proximity?: Proximity; country?: string };

export function buildGeocodeUrl(
  address: string,
  token: string,
  bias?: GeocodeBias,
): string {
  const q = encodeURIComponent(address);
  const parts = [`q=${q}`, "limit=1"];
  if (bias?.country) parts.push(`country=${encodeURIComponent(bias.country)}`);
  if (bias?.proximity) {
    parts.push(`proximity=${bias.proximity.lng},${bias.proximity.lat}`);
  }
  parts.push(`access_token=${token}`);
  return `https://api.mapbox.com/search/geocode/v6/forward?${parts.join("&")}`;
}

export function parseGeocode(
  json: unknown,
): { lat: number; lng: number } | null {
  const features = (json as { features?: unknown[] })?.features;
  if (!Array.isArray(features) || features.length === 0) return null;
  const coords = (features[0] as { geometry?: { coordinates?: number[] } })
    ?.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const [lng, lat] = coords;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return { lat, lng };
}

export async function geocodeAddress(
  address: string,
  bias?: GeocodeBias,
): Promise<{ lat: number; lng: number } | null> {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) throw new Error("MAPBOX_TOKEN is not set");
  const res = await fetch(buildGeocodeUrl(address, token, bias));
  if (!res.ok) return null;
  return parseGeocode(await res.json());
}
