/**
 * StatusBadge — extracted sub-component.
 *
 * Extracted from FactoryInvoiceLoadingScan.tsx during the Phase 4 god-file split.
 */
import { Badge } from "@/components/ui/badge";
import { useFactoryText } from "@/i18n/modules/factory";

export function StatusBadge({ status }: { status: string }) {
  const tUi = useFactoryText();
  if (status === "OPEN")
    return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">{tUi("open")}</Badge>;
  if (status === "COMPLETED")
    return (
      <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">{tUi("completed")}</Badge>
    );
  if (status === "CANCELLED") return <Badge variant="secondary">{tUi("cancelled")}</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}
