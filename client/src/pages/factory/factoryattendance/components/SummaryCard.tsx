/**
 * SummaryCard — extracted sub-component.
 *
 * Extracted from FactoryAttendance.tsx during the Phase 4 god-file split.
 */
import { Card, CardContent } from "@/components/ui/card";

export function SummaryCard({
  icon,
  label,
  value,
  color,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
  testId: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4 flex items-center gap-3">
        <div className={`shrink-0 ${color}`}>{icon}</div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-2xl font-bold ${color}`} data-testid={testId}>
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
