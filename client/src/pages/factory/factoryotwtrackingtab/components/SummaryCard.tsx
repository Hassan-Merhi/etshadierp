/**
 * SummaryCard — extracted sub-component.
 *
 * Extracted from FactoryOtwTrackingTab.tsx during the Phase 4 god-file split.
 */
import { cn } from "@/lib/utils";

export // ── Summary Card (mirrors ERP SummaryCard) ───────────────────────────────────
function SummaryCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 min-w-0">
      <div className={cn("flex items-center justify-center h-9 w-9 rounded-md shrink-0", accent ?? "bg-muted")}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground font-medium leading-none mb-1 whitespace-nowrap">{label}</p>
        <p className="text-xl font-bold leading-none tracking-tight whitespace-nowrap">{value}</p>
      </div>
    </div>
  );
}

// ── Status badge ─────────────────────────────────────────────────────────────
