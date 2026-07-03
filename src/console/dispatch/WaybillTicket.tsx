const LAMP: Record<string, string> = {
  delivered: "#22c55e",
  en_route: "#f59e0b",
  assigned: "#64748b",
  unassigned: "#64748b",
  failed: "#ef4444",
};

export function WaybillTicket({
  address,
  status,
  sequence,
  eta,
  onAction,
  actionLabel,
}: {
  address: string;
  status: string;
  sequence?: number | null;
  eta?: string;
  onAction?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded border border-[#1e293b] bg-white/[0.02] px-3 py-2">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: LAMP[status] ?? "#64748b" }}
        aria-hidden
      />
      {sequence != null && (
        <span className="font-mono text-xs text-[#38bdf8]">
          {String(sequence + 1).padStart(2, "0")}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-sm">{address}</span>
      {eta && <span className="font-mono text-xs text-[#64748b]">{eta}</span>}
      {onAction && actionLabel && (
        <button
          onClick={onAction}
          className="rounded border border-[#1e293b] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[#94a3b8] hover:border-[#38bdf8] hover:text-[#38bdf8] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#38bdf8]"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
