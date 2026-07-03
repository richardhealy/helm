"use client";

import { useCallback, useEffect, useState } from "react";
import type { DispatchBoard } from "@/dispatch/board";
import { fleetStatusLine } from "@/dispatch/format";
import { WaybillTicket } from "./WaybillTicket";

const LABEL = "text-[10px] uppercase tracking-widest text-[#64748b]";

export function DispatchPanel() {
  const [board, setBoard] = useState<DispatchBoard | null>(null);
  const [address, setAddress] = useState("");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/dispatch");
    if (res.ok) setBoard(await res.json());
  }, []);

  useEffect(() => {
    refresh();
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
        <p className={LABEL}>Unassigned · {board?.unassigned.length ?? 0}</p>
        {board && board.unassigned.length === 0 ? (
          <p className="text-xs text-[#475569]">No unassigned deliveries. Add one above.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {board?.unassigned.map((d) => (
              <WaybillTicket key={d.id} address={d.address} status="unassigned" />
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
