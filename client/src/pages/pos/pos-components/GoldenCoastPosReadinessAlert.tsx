import { AlertTriangle } from "lucide-react";

interface GoldenCoastPosReadinessAlertProps {
  blockers?: readonly string[];
}

export function GoldenCoastPosReadinessAlert({
  blockers = [],
}: GoldenCoastPosReadinessAlertProps) {
  return (
    <div
      role="alert"
      data-testid="golden-coast-pos-readiness-alert"
      className="mx-3 mt-3 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-950 dark:text-amber-100 lg:mx-4"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <div className="min-w-0 space-y-1.5 text-sm">
        <p className="font-semibold">Golden Coast POS is unavailable</p>
        <p>Golden Coast sales use the company’s current inventory cost. Resolve the accounting setup issue below to continue.</p>
        {blockers.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-amber-900/80 dark:text-amber-100/80">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}