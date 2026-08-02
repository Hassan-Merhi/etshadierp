/**
 * InfoRow — extracted sub-component.
 *
 * Extracted from BarcodeLookup.tsx during the Phase 4 god-file split.
 */

export function InfoRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`font-medium ${mono ? "font-mono" : ""}`}>
        {value ?? <span className="text-muted-foreground">N/A</span>}
      </p>
    </div>
  );
}
