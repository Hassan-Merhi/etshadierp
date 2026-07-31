/**
 * StatRow — extracted sub-component.
 *
 * Extracted from DailyProductionReport.tsx during the Phase 4 god-file split.
 */

export function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="text-right">
        <div className="text-sm font-bold">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}
