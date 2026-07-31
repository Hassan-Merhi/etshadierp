/**
 * DocIndicator — extracted sub-component.
 *
 * Extracted from FactoryShippingContainers.tsx during the Phase 4 god-file split.
 */
import {CheckCircle2, XCircle} from "lucide-react";

export function DocIndicator({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 group" data-testid="button-open-docs">
      {count > 0 ? (
        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
      ) : (
        <XCircle className="h-4 w-4 text-red-500 shrink-0" />
      )}
      <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors underline underline-offset-2">
        {count > 0 ? `${count} file${count !== 1 ? "s" : ""}` : "None"}
      </span>
    </button>
  );
}

// ─── Inline editable text cell ─────────────────────────────────────────────────
