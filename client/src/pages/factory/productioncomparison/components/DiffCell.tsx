/**
 * DiffCell — extracted sub-component.
 *
 * Extracted from ProductionComparison.tsx during the Phase 4 god-file split.
 */
import {TrendingUp, TrendingDown, Minus} from "lucide-react";

export function DiffCell({
  value,
  fmt,
  isInfinite,
}: {
  value: number;
  fmt: (n: number) => string;
  isInfinite?: boolean;
}) {
  if (isInfinite) return <span className="text-xs text-muted-foreground">N/A</span>;
  if (value > 0)
    return (
      <span className="inline-flex items-center justify-end gap-0.5 text-emerald-600 font-medium tabular-nums">
        <TrendingUp className="h-3.5 w-3.5 shrink-0" />
        {fmt(value)}
      </span>
    );
  if (value < 0)
    return (
      <span className="inline-flex items-center justify-end gap-0.5 text-red-500 font-medium tabular-nums">
        <TrendingDown className="h-3.5 w-3.5 shrink-0" />
        {fmt(value)}
      </span>
    );
  return (
    <span className="inline-flex items-center justify-end gap-0.5 text-muted-foreground tabular-nums">
      <Minus className="h-3.5 w-3.5 shrink-0" />0
    </span>
  );
}
