/**
 * SectionHeader — extracted sub-component.
 *
 * Extracted from FactoryFinancialSnapshot.tsx during the Phase 4 god-file split.
 */

export function SectionHeader({ title, color }: { title: string; color: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="h-3.5 w-1 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
    </div>
  );
}
