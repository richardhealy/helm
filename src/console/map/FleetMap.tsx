"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  parsePositionEvent,
  toGeoJson,
  type VehiclePosition,
} from "./markers";
import { routesToGeoJson, type RouteView } from "./routes";
import type { VehicleSummary } from "@/fleet/registry/vehicles";

const SOURCE_ID = "vehicles";

function initialPositions(vehicles: VehicleSummary[]): VehiclePosition[] {
  return vehicles
    .filter((v) => v.lat !== null && v.lng !== null)
    .map((v) => ({
      vehicleId: v.id,
      lat: v.lat as number,
      lng: v.lng as number,
      heading: v.heading ?? 0,
    }));
}

export function FleetMap({
  vehicles,
  routes,
}: {
  vehicles: VehicleSummary[];
  routes: RouteView[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const positions = useRef<Map<string, VehiclePosition>>(
    new Map(initialPositions(vehicles).map((p) => [p.vehicleId, p])),
  );
  const routeViews = useRef<Map<string, RouteView>>(
    new Map(routes.map((r) => [r.vehicleId, r])),
  );

  useEffect(() => {
    if (!containerRef.current) return;
    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

    const first = [...positions.current.values()][0];
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: first ? [first.lng, first.lat] : [-0.12, 51.5],
      zoom: 11,
    });

    const render = () => {
      const src = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      if (src) src.setData(toGeoJson([...positions.current.values()]));
    };

    const renderRoutes = () => {
      const src = map.getSource("routes") as mapboxgl.GeoJSONSource | undefined;
      if (src) src.setData(routesToGeoJson([...routeViews.current.values()]));
    };

    map.on("load", () => {
      // Register our own arrow icon rather than relying on the style's sprite —
      // modern Mapbox styles (dark-v11) don't ship the classic Maki icons.
      if (!map.hasImage("vehicle-arrow")) {
        const size = 22;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#38bdf8";
        ctx.strokeStyle = "#0c4a6e";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(size / 2, 2); // nose (points north / heading 0)
        ctx.lineTo(size - 3, size - 3);
        ctx.lineTo(size / 2, size - 7); // notch for a chevron look
        ctx.lineTo(3, size - 3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        const image = ctx.getImageData(0, 0, size, size);
        map.addImage("vehicle-arrow", {
          width: size,
          height: size,
          data: new Uint8Array(image.data.buffer),
        });
      }

      map.addSource("routes", {
        type: "geojson",
        data: routesToGeoJson([...routeViews.current.values()]),
      });
      map.addLayer({
        id: "route-lines",
        type: "line",
        source: "routes",
        paint: {
          "line-color": "#38bdf8",
          "line-width": 3,
          "line-opacity": 0.7,
        },
      });

      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: toGeoJson([...positions.current.values()]),
      });
      map.addLayer({
        id: "vehicles-arrows",
        type: "symbol",
        source: SOURCE_ID,
        layout: {
          "icon-image": "vehicle-arrow",
          "icon-rotate": ["get", "heading"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-size": 1.2,
        },
      });
      render();
    });

    const es = new EventSource("/api/stream");
    es.addEventListener("vehicle_position", (e) => {
      const pos = parsePositionEvent((e as MessageEvent).data);
      if (!pos) return;
      positions.current.set(pos.vehicleId, pos);
      render();
    });
    es.addEventListener("route_updated", async (e) => {
      const { vehicleId } = JSON.parse((e as MessageEvent).data) as {
        vehicleId: string;
      };
      const res = await fetch(`/api/vehicles/${vehicleId}/route`);
      if (!res.ok) return;
      const { geometry } = (await res.json()) as { geometry: GeoJSON.LineString };
      routeViews.current.set(vehicleId, { vehicleId, geometry });
      renderRoutes();
    });

    return () => {
      es.close();
      map.remove();
    };
  }, []);

  return <div ref={containerRef} className="h-screen w-full" />;
}
