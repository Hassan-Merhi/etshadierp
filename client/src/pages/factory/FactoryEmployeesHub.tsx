import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, DollarSign, CalendarDays, Banknote, Gift, ArrowDownCircle } from "lucide-react";
import FactoryEmployees from "@/pages/factory/FactoryEmployees";
import FactoryEmployeePayrollTab from "@/pages/factory/FactoryEmployeePayrollTab";
import FactoryEmployeeAttendanceTab from "@/pages/factory/FactoryEmployeeAttendanceTab";
import FactoryEmployeeAdvancesTab from "@/pages/factory/FactoryEmployeeAdvancesTab";
import FactoryEmployeeBonusesTab from "@/pages/factory/FactoryEmployeeBonusesTab";
import FactoryEmployeeWithdrawalsTab from "@/pages/factory/FactoryEmployeeWithdrawalsTab";
import { useHubQueryState } from "@/hooks/use-hub-query-state";

type TabValue = "employees" | "payroll" | "attendance" | "advances" | "bonuses" | "withdrawals";

const TAB_OPTIONS: { value: TabValue; label: string; icon: React.ElementType }[] = [
  { value: "employees", label: "Employees", icon: Users },
  { value: "payroll", label: "Payroll", icon: DollarSign },
  { value: "attendance", label: "Attendance", icon: CalendarDays },
  { value: "advances", label: "Advances", icon: Banknote },
  { value: "bonuses", label: "Bonuses", icon: Gift },
  { value: "withdrawals", label: "Withdrawals", icon: ArrowDownCircle },
];

export default function FactoryEmployeesHub() {
  const [tab, setTab] = useHubQueryState<TabValue>({
    key: "tab",
    values: TAB_OPTIONS.map((option) => option.value),
    defaultValue: "employees",
  });

  const current = TAB_OPTIONS.find((option) => option.value === tab)!;
  const Icon = current.icon;

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as TabValue)}>
      <div className="mb-4">
        <Select value={tab} onValueChange={(value) => setTab(value as TabValue)}>
          <SelectTrigger className="w-52" data-testid="select-employees-section">
            <SelectValue>
              <span className="flex items-center gap-2">
                <Icon className="h-4 w-4 shrink-0" />
                {current.label}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {TAB_OPTIONS.map(({ value, label, icon: ItemIcon }) => (
              <SelectItem key={value} value={value} data-testid={`option-${value}`}>
                <span className="flex items-center gap-2">
                  <ItemIcon className="h-4 w-4 shrink-0" />
                  {label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <TabsContent value="employees" className="mt-0"><FactoryEmployees /></TabsContent>
      <TabsContent value="payroll" className="mt-0"><FactoryEmployeePayrollTab /></TabsContent>
      <TabsContent value="attendance" className="mt-0"><FactoryEmployeeAttendanceTab /></TabsContent>
      <TabsContent value="advances" className="mt-0"><FactoryEmployeeAdvancesTab /></TabsContent>
      <TabsContent value="bonuses" className="mt-0"><FactoryEmployeeBonusesTab /></TabsContent>
      <TabsContent value="withdrawals" className="mt-0"><FactoryEmployeeWithdrawalsTab /></TabsContent>
    </Tabs>
  );
}
