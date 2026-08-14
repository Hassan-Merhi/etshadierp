import { PayrollView } from "./payroll/PayrollView";
import { usePayrollModel } from "./payroll/usePayrollModel";

export default function Payroll() {
  const model = usePayrollModel();
  return <PayrollView model={model} />;
}
