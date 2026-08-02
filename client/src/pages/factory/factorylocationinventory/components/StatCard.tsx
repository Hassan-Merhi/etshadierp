/**
 * StatCard — extracted sub-component.
 *
 * Extracted from FactoryLocationInventory.tsx during the Phase 4 god-file split.
 */

import type { StatCardProps } from "../types";

export function StatCard({ icon, label, value, sub, accent }: StatCardProps) {
  return (
    <div className="rounded-xl border overflow-hidden flex-1 min-w-[140px]">
      <div className="px-4 py-4">
        <div className="mb-3">
          <div className={`inline-flex p-1.5 rounded-md ${accent ?? "bg-muted"}`}>{icon}</div>
        </div>
        <div className="text-2xl font-bold font-mono leading-tight">{value}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
        {sub && <div className="text-xs text-muted-foreground/70 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}
