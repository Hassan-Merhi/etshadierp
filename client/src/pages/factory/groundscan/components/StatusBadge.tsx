/**
 * StatusBadge — extracted sub-component.
 *
 * Extracted from GroundScan.tsx during the Phase 4 god-file split.
 */
import { Badge } from "@/components/ui/badge";
import { useFactoryText } from "@/i18n/modules/factory";

export function StatusBadge({ status, isInLoadingOrder }: { status: string; isInLoadingOrder?: boolean }) {
  const tUi = useFactoryText();
  const s = (status || "").toUpperCase();
  if ((s === "IN_STOCK" || s === "LOADING" || s === "LOADED") && isInLoadingOrder)
    return <Badge className="bg-amber-500 text-white border-0">{tUi("loading.3")}</Badge>;
  if (s === "IN_STOCK") return <Badge className="bg-green-600 text-white border-0">{tUi("in.stock")}</Badge>;
  if (s === "LOADING" || s === "LOADED")
    return <Badge className="bg-amber-500 text-white border-0">{tUi("loading.3")}</Badge>;
  if (s === "SOLD") return <Badge className="bg-red-600 text-white border-0">{tUi("sold")}</Badge>;
  if (s === "RESERVED_FOR_ORDER") return <Badge className="bg-blue-600 text-white border-0">{tUi("reserved")}</Badge>;
  if (s === "LABEL_PRINTED") return <Badge variant="outline">{tUi("label.printed")}</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}
