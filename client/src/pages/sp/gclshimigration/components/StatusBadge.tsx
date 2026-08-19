/**
 * StatusBadge — extracted sub-component.
 *
 * Extracted from GcLshiMigration.tsx during the Phase 4 god-file split.
 */
import {Badge} from "@/components/ui/badge";

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    completed: { variant: "default", label: "Completed" },
    running: { variant: "secondary", label: "Running" },
    failed: { variant: "destructive", label: "Failed" },
    rolled_back: { variant: "outline", label: "Rolled Back" },
  };
  const cfg = map[status] ?? { variant: "secondary", label: status };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

// ── Main Page ──────────────────────────────────────────────────────────────
