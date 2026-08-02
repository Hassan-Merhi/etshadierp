/**
 * StatusBadge — extracted sub-component.
 *
 * Extracted from GroundScan.tsx during the Phase 4 god-file split.
 */
import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status, isInLoadingOrder }: { status: string; isInLoadingOrder?: boolean }) {
  const s = (status || "").toUpperCase();
  if ((s === "IN_STOCK" || s === "LOADING" || s === "LOADED") && isInLoadingOrder)
    return <Badge className="bg-amber-500 text-white border-0">Loading</Badge>;
  if (s === "IN_STOCK") return <Badge className="bg-green-600 text-white border-0">In Stock</Badge>;
  if (s === "LOADING" || s === "LOADED") return <Badge className="bg-amber-500 text-white border-0">Loading</Badge>;
  if (s === "SOLD") return <Badge className="bg-red-600 text-white border-0">Sold</Badge>;
  if (s === "RESERVED_FOR_ORDER") return <Badge className="bg-blue-600 text-white border-0">Reserved</Badge>;
  if (s === "LABEL_PRINTED") return <Badge variant="outline">Label Printed</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}
