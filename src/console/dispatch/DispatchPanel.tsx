"use client";

import { useCallback, useEffect, useState } from "react";
import type { DispatchBoard } from "@/dispatch/board";
import { fleetStatusLine } from "@/dispatch/format";

const LABEL = "text-[10px] uppercase tracking-widest text-[#64748b]";

export function DispatchPanel() {
  const [board, setBoard] = useState<DispatchBoard | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/dispatch");
    if (res.ok) setBoard(await res.json());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <aside className="absolute inset-y-0 left-0 z-10 flex w-[380px] flex-col gap-4 overflow-y-auto border-r border-[#1e293b] bg-[#0b1220]/85 p-5 text-[#e2e8f0] backdrop-blur-md">
      <header>
        <h1 className="font-mono text-lg tracking-tight">DISPATCH</h1>
        <p className={LABEL}>
          {board ? fleetStatusLine(board.vehicles) : "connecting…"}
        </p>
      </header>
      {/* intake (Task 4), unassigned pool (Task 4), vehicle roster (Task 5) */}
    </aside>
  );
}
