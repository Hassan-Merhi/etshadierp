import { FactorySupplierStatementBranch } from "./FactorySupplierStatementBranch";
import { FactorySuppliersBrokerBranch } from "./FactorySuppliersBrokerBranch";
import { FactorySuppliersDirectory } from "./FactorySuppliersDirectory";
import type { useFactorySuppliersModel } from "./useFactorySuppliersModel";

type SuppliersModel = ReturnType<typeof useFactorySuppliersModel>;

export function FactorySuppliersView({ model }: { model: SuppliersModel }) {
  if (model.statementSupplierId) return <FactorySupplierStatementBranch model={model} />;
  if (model.parentViewSupplierId) return <FactorySuppliersBrokerBranch model={model} />;
  return <FactorySuppliersDirectory model={model} />;
}
