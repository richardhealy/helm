"use client";

import { useCallback, useEffect, useState } from "react";
import type { DispatchBoard } from "@/dispatch/board";
import { fleetStatusLine, formatEta, formatEventTime } from "@/dispatch/format";
import { WaybillTicket } from "./WaybillTicket";

const LABEL = "text-[10px] uppercase tracking-widest text-[#64748b]";

export function DispatchPanel() {
  const [board, setBoard] = useState<DispatchBoard | null>(null);
  const [address, setAddress] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

  // The assign target: the explicitly picked vehicle, else the first one.
  // Derived (not synced via an effect) so there's no cascading setState.
  const selectedVehicle = picked ?? board?.vehicles[0]?.id ?? null;

  const refresh = useCallback(async () => {
    const res = await fetch("/api/dispatch");
    if (res.ok) setBoard(await res.json());
  }, []);

  // Initial load + refresh when a route or stop changes (not on every position
  // ping, which fires ~1/s and would hammer the endpoint). setState happens in
  // the async callback / event listeners, after await — never synchronously.
  useEffect(() => {
    void (async () => {
      await refresh();
    })();
    const es = new EventSource("/api/stream");
    es.addEventListener("route_updated", () => refresh());
    es.addEventListener("stop_status", () => refresh());
    return () => es.close();
  }, [refresh]);

  const addDelivery = useCallback(async () => {
    if (!address.trim()) return;
    await fetch("/api/deliveries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address,
        bias: { country: "gb", proximity: { lat: 51.5, lng: -0.12 } },
      }),
    });
    setAddress("");
    refresh();
  }, [address, refresh]);

  const optimize = useCallback(
    async (vehicleId: string) => {
      await fetch(`/api/vehicles/${vehicleId}/optimize`, { method: "POST" });
      refresh();
    },
    [refresh],
  );

  const dispatchFleet = useCallback(async () => {
    await fetch("/api/dispatch/fleet", { method: "POST" });
    refresh();
  }, [refresh]);

  const assign = useCallback(
    async (deliveryId: string, vehicleId: string) => {
      await fetch(`/api/deliveries/${deliveryId}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vehicleId }),
      });
      refresh();
    },
    [refresh],
  );

  const unassign = useCallback(
    async (deliveryId: string) => {
      await fetch(`/api/deliveries/${deliveryId}/unassign`, { method: "POST" });
      refresh();
    },
    [refresh],
  );

  return (
    <aside className="absolute inset-y-0 left-0 z-10 flex w-[380px] flex-col gap-4 overflow-y-auto border-r border-[#1e293b] bg-[#0b1220]/85 p-5 text-[#e2e8f0] backdrop-blur-md">
      <header>
        <h1 className="font-mono text-lg tracking-tight">DISPATCH</h1>
        <p className={LABEL}>
          {board ? fleetStatusLine(board.vehicles) : "connecting…"}
        </p>
      </header>

      <section className="flex flex-col gap-2">
        <label className={LABEL} htmlFor="addr">Add delivery</label>
        <div className="flex gap-2">
          <input
            id="addr"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addDelivery()}
            placeholder="Address"
            className="min-w-0 flex-1 rounded border border-[#1e293b] bg-black/20 px-3 py-1.5 text-sm placeholder:text-[#475569] focus:border-[#38bdf8] focus:outline-none"
          />
          <button
            onClick={addDelivery}
            className="rounded bg-[#38bdf8] px-3 py-1.5 text-xs font-medium text-[#0b1220] hover:bg-[#7dd3fc] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38bdf8]"
          >
            Add
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className={LABEL}>Unassigned · {board?.unassigned.length ?? 0}</p>
          {board && board.unassigned.length > 0 && (
            <button
              onClick={dispatchFleet}
              className="rounded bg-[#38bdf8] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#0b1220] hover:bg-[#7dd3fc] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38bdf8]"
            >
              Dispatch fleet
            </button>
          )}
        </div>
        {board && board.unassigned.length === 0 ? (
          <p className="text-xs text-[#475569]">No unassigned deliveries. Add one above.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {board?.unassigned.map((d) => (
              <WaybillTicket
                key={d.id}
                address={d.address}
                status="unassigned"
                actionLabel={selectedVehicle ? "Assign" : undefined}
                onAction={
                  selectedVehicle ? () => assign(d.id, selectedVehicle) : undefined
                }
              />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <p className={LABEL}>Fleet</p>
        {board?.vehicles.map((v) => (
          <div key={v.id} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${v.status === "en_route" ? "motion-safe:animate-pulse" : ""}`}
                style={{ backgroundColor: v.status === "en_route" ? "#f59e0b" : v.status === "offline" ? "#475569" : "#64748b" }}
                aria-hidden
              />
              <button
                onClick={() => setPicked(v.id)}
                className={`flex-1 text-left font-mono text-sm ${selectedVehicle === v.id ? "text-[#38bdf8]" : "text-[#e2e8f0]"}`}
              >
                {v.label}
                {selectedVehicle === v.id && (
                  <span className="ml-2 text-[10px] uppercase tracking-wider text-[#38bdf8]">target</span>
                )}
              </button>
              <span className={LABEL}>{v.stops.length} stops</span>
              <button
                onClick={() => optimize(v.id)}
                className="rounded border border-[#1e293b] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[#94a3b8] hover:border-[#38bdf8] hover:text-[#38bdf8] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#38bdf8]"
              >
                Optimize
              </button>
            </div>
            <div className="flex flex-col gap-1 pl-4">
              {v.stops.length === 0 ? (
                <p className="text-xs text-[#475569]">No stops assigned.</p>
              ) : (
                v.stops.map((s) => (
                  <WaybillTicket
                    key={s.id}
                    address={s.address}
                    status={s.status}
                    sequence={s.sequence}
                    eta={formatEta(s.eta)}
                    actionLabel="Unassign"
                    onAction={() => unassign(s.id)}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <p className={LABEL}>Activity</p>
        {board && board.events.length === 0 ? (
          <p className="text-xs text-[#475569]">No activity yet.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {board?.events.map((e) => (
              <div key={e.id} className="flex items-baseline gap-2 font-mono text-xs">
                <span className="text-[#475569]">{formatEventTime(e.createdAt)}</span>
                <span className="text-[#38bdf8]">{e.type}</span>
                <span className="min-w-0 flex-1 truncate text-[#94a3b8]">
                  {e.detail ?? e.actor}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
