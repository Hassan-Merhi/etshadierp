import { FactoryPayrollView } from "./factorypayroll/FactoryPayrollView";
import { useFactoryPayrollModel } from "./factorypayroll/useFactoryPayrollModel";

export default function FactoryPayrollPage() {
  const model = useFactoryPayrollModel();
  return <FactoryPayrollView model={model} />;
}
