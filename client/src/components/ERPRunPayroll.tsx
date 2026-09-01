import { ERPRunPayrollView } from "./erprunpayroll/ERPRunPayrollView";
import { useERPRunPayrollModel } from "./erprunpayroll/useERPRunPayrollModel";

export default function ERPRunPayroll() {
  const model = useERPRunPayrollModel();
  return <ERPRunPayrollView model={model} />;
}
