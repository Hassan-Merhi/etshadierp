import { useCompany } from "@/contexts/CompanyContext";
import { SupplierProfitCheckView } from "./supplierprofitcheck/SupplierProfitCheckView";
import { useSupplierProfitCheckModel } from "./supplierprofitcheck/useSupplierProfitCheckModel";

function SupplierProfitCheckForCompany() {
  const model = useSupplierProfitCheckModel();
  return <SupplierProfitCheckView model={model} />;
}

export default function SupplierProfitCheck() {
  const { selectedCompany } = useCompany();

  // Do not start company-owned queries until the server/session company has
  // finished synchronizing. The key forces a clean model when companies switch
  // so supplier, proforma, quantity, and override state cannot bleed across.
  if (!selectedCompany) return null;
  return <SupplierProfitCheckForCompany key={selectedCompany.id} />;
}
