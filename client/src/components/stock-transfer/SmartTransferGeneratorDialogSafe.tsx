import { useEffect, useState } from "react";
import { queryClient } from "@/lib/queryClient";
import { useCompany } from "@/contexts/CompanyContext";
import BaseSmartTransferGeneratorDialog from "./SmartTransferGeneratorDialog.tsx";
import type { SmartPreviewOrderItem } from "./smartTransferPreviewUi";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (payload: {
    destinationLocationId: number;
    sourceLocationIds: number[];
    orderItems: SmartPreviewOrderItem[];
  }) => void;
}

/**
 * Ensures query data used by the generator is never carried across company
 * switches. The server is company-scoped too; this prevents confusing stale
 * labels/items from briefly appearing in the UI.
 */
export default function SmartTransferGeneratorDialogSafe(props: Props) {
  const { selectedCompany } = useCompany();
  const companyId = selectedCompany?.id ?? null;
  const [preparedCompanyId, setPreparedCompanyId] = useState<number | null>(null);

  useEffect(() => {
    if (!props.open) {
      setPreparedCompanyId(null);
      return;
    }

    queryClient.removeQueries({
      predicate: (query) => query.queryKey.includes("smart-transfer-generator"),
    });
    setPreparedCompanyId(companyId);
  }, [props.open, companyId]);

  if (props.open && preparedCompanyId !== companyId) return null;

  return <BaseSmartTransferGeneratorDialog key={companyId ?? "no-company"} {...props} />;
}
