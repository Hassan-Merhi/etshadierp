import useFactoryPayroll from "./factorypayrolltab/useFactoryPayroll";
import { PayrollOverview } from "./factorypayrolltab/components/PayrollOverview";
import { PayrollRunDialogs } from "./factorypayrolltab/components/PayrollRunDialogs";
import { PayrollPaymentDialogs } from "./factorypayrolltab/components/PayrollPaymentDialogs";

// Layout shell. State lives in useFactoryPayroll; the overview and the two
// dialog groups are separate components so no single file carries the whole tab.
export default function FactoryPayrollTab() {
  const payroll = useFactoryPayroll();

  return (
    <div className="space-y-5">
      <PayrollOverview payroll={payroll} />
      <PayrollRunDialogs payroll={payroll} />
      <PayrollPaymentDialogs payroll={payroll} />
    </div>
  );
}
