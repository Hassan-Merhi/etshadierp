/**
 * RateCell — extracted sub-component.
 *
 * Extracted from PostOffloadDialog.tsx during the Phase 4 god-file split.
 */

export function RateCell({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">${parseFloat(value).toFixed(8)}</span>
    </div>
  );
}
