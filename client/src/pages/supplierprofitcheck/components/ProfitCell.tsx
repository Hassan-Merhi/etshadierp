/**
 * ProfitCell — extracted sub-component.
 *
 * Extracted from SupplierProfitCheck.tsx during the Phase 4 god-file split.
 */

import {fmt} from "../utils";

export function ProfitCell({ value, pct }: { value: number | null; pct: number | null }) {
  if (value == null) return <span className="text-muted-foreground text-xs">—</span>;
  const positive = value >= 0;
  return (
    <div
      className={`text-right font-semibold tabular-nums ${positive ? "text-emerald-500 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}
    >
      <div className="text-sm">
        {value < 0 ? "-" : ""}${fmt(Math.abs(value))}
      </div>
      {pct != null && <div className="text-[11px] font-normal opacity-70">{fmt(Math.abs(pct), 1)}%</div>}
    </div>
  );
}
