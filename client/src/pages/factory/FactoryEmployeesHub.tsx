import { useState } from "react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, DollarSign, CalendarDays, Banknote, Gift, ArrowDownCircle } from "lucide-react";
import FactoryEmployees from "@/pages/factory/FactoryEmployees";
import FactoryEmployeePayrollTab from "@/pages/factory/FactoryEmployeePayrollTab";
import FactoryEmployeeAttendanceTab from "@/pages/factory/FactoryEmployeeAttendanceTab";
import FactoryEmployeeAdvancesTab from "@/pages/factory/FactoryEmployeeAdvancesTab";
import FactoryEmployeeBonusesTab from "@/pages/factory/FactoryEmployeeBonusesTab";
import FactoryEmployeeWithdrawalsTab from "@/pages/factory/FactoryEmployeeWithdrawalsTab";

type TabValue = "employees" | "payroll" | "attendance" | "advances" | "bonuses" | "withdrawals";

const TAB_OPTIONS: { value: TabValue; label: string; icon: React.ElementType }[] = [
  { value: "employees", label: "Employees", icon: Users },
  { value: "payroll", label: "Payroll", icon: DollarSign },
  { value: "attendance", label: "Attendance", icon: CalendarDays },
  { value: "advances", label: "Advances", icon: Banknote },
  { value: "bonuses", label: "Bonuses", icon: Gift },
  { value: "withdrawals", label: "Withdrawals", icon: ArrowDownCircle },
];

function getInitialTab(): TabValue {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  if (tab === "payroll") return "payroll";
  if (tab === "attendance") return "attendance";
  if (tab === "advances") return "advances";
  if (tab === "bonuses") return "bonuses";
  if (tab === "withdrawals") return "withdrawals";
  return "employees";
}

function setTabInUrl(tab: TabValue) {
  const url = new URL(window.location.href);
  if (tab === "employees") {
    url.searchParams.delete("tab");
  } else {
    url.searchParams.set("tab", tab);
  }
  window.history.replaceState(null, "", url.toString());
}

export default function FactoryEmployeesHub() {
  const [tab, setTab] = useState<TabValue>(getInitialTab);

  const handleTabChange = (v: string) => {
    const newTab = v as TabValue;
    setTab(newTab);
    setTabInUrl(newTab);
  };

  const current = TAB_OPTIONS.find((o) => o.value === tab)!;
  const Icon = current.icon;

  return (
    <Tabs value={tab} onValueChange={handleTabChange}>
      <div className="mb-4">
        <Select value={tab} onValueChange={handleTabChange}>
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

      <TabsContent value="employees" className="mt-0">
        <FactoryEmployees />
      </TabsContent>
      <TabsContent value="payroll" className="mt-0">
        <FactoryEmployeePayrollTab />
      </TabsContent>
      <TabsContent value="attendance" className="mt-0">
        <FactoryEmployeeAttendanceTab />
      </TabsContent>
      <TabsContent value="advances" className="mt-0">
        <FactoryEmployeeAdvancesTab />
      </TabsContent>
      <TabsContent value="bonuses" className="mt-0">
        <FactoryEmployeeBonusesTab />
      </TabsContent>
      <TabsContent value="withdrawals" className="mt-0">
        <FactoryEmployeeWithdrawalsTab />
      </TabsContent>
    </Tabs>
  );
}
