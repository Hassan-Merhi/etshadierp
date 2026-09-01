import { useEffect } from "react";
import { useCompany } from "@/contexts/CompanyContext";
import SalesReportLegacy from "./SalesReportLegacy";

declare global {
  // Compatibility binding for the pre-existing Sales Report implementation.
  // The legacy module references selectedCompany directly in its stock-item query key.
  // This wrapper supplies the live CompanyContext value until that large page is split safely.
  var selectedCompany: ReturnType<typeof useCompany>["selectedCompany"] | undefined;
}

export default function SalesReport() {
  const { selectedCompany } = useCompany();
  globalThis.selectedCompany = selectedCompany;

  useEffect(
    () => () => {
      if (globalThis.selectedCompany === selectedCompany) {
        globalThis.selectedCompany = undefined;
      }
    },
    [selectedCompany],
  );

  return <SalesReportLegacy />;
}
