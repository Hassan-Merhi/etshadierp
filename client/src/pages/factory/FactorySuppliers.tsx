import { FactorySuppliersView } from "./factory-suppliers/FactorySuppliersView";
import { useFactorySuppliersModel } from "./factory-suppliers/useFactorySuppliersModel";

export default function FactorySuppliers() {
  const model = useFactorySuppliersModel();
  return <FactorySuppliersView model={model} />;
}
