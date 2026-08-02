/**
 * ContainerStatusBadge — extracted sub-component.
 *
 * Extracted from FactoryOtwTrackingTab.tsx during the Phase 4 god-file split.
 */
import { Badge } from "@/components/ui/badge";
import { CONTAINER_STATUS_LABELS } from "../utils";

export function ContainerStatusBadge({ status }: { status: string }) {
  const label = CONTAINER_STATUS_LABELS[status] ?? status;
  if (status === "OFFLOADED")
    return (
      <Badge className="text-xs bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20">{label}</Badge>
    );
  if (status === "IN_TRANSIT")
    return (
      <Badge className="text-xs bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20">{label}</Badge>
    );
  if (status === "ARRIVED")
    return (
      <Badge className="text-xs bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20">
        {label}
      </Badge>
    );
  return (
    <Badge variant="secondary" className="text-xs">
      {label}
    </Badge>
  );
}

// ── Inline ETA cell ──────────────────────────────────────────────────────────
