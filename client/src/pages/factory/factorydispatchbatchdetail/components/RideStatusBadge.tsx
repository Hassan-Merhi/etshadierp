/**
 * RideStatusBadge — extracted sub-component.
 *
 * Extracted from FactoryDispatchBatchDetail.tsx during the Phase 4 god-file split.
 */
import { Badge } from "@/components/ui/badge";
import { RIDE_STATUS_CONFIG } from "../utils";

export function RideStatusBadge({ status }: { status: string }) {
  const cfg = RIDE_STATUS_CONFIG[status] || { label: status, className: "" };
  return <Badge className={cfg.className}>{cfg.label}</Badge>;
}
