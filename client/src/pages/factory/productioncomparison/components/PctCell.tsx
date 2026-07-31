/**
 * PctCell — extracted sub-component.
 *
 * Extracted from ProductionComparison.tsx during the Phase 4 god-file split.
 */
import {TrendingUp, TrendingDown, Minus} from "lucide-react";
import {fmtPct} from "../utils";

export function PctCell({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-muted-foreground">N/A</span>;
  if (pct > 0)
    return (
      <span className="inline-flex items-center justify-end gap-0.5 text-emerald-600 font-medium tabular-nums">
        <TrendingUp className="h-3.5 w-3.5 shrink-0" />
        {fmtPct(pct)}
      </span>
    );
  if (pct < 0)
    return (
      <span className="inline-flex items-center justify-end gap-0.5 text-red-500 font-medium tabular-nums">
        <TrendingDown className="h-3.5 w-3.5 shrink-0" />
        {fmtPct(pct)}
      </span>
    );
  return (
    <span className="inline-flex items-center justify-end gap-0.5 text-muted-foreground tabular-nums">
      <Minus className="h-3.5 w-3.5 shrink-0" />
      0.0%
    </span>
  );
}
