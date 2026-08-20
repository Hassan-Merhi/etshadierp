import { SupplierProfitCheckView } from "./supplierprofitcheck/SupplierProfitCheckView";
import { useSupplierProfitCheckModel } from "./supplierprofitcheck/useSupplierProfitCheckModel";

export default function SupplierProfitCheck() {
  const model = useSupplierProfitCheckModel();
  return <SupplierProfitCheckView model={model} />;
}
