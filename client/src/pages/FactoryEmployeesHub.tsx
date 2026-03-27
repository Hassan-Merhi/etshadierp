import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, DollarSign, CalendarDays, Banknote, Gift } from "lucide-react";
import FactoryEmployees from "@/pages/FactoryEmployees";
import FactoryEmployeePayrollTab from "@/pages/FactoryEmployeePayrollTab";
import FactoryEmployeeAttendanceTab from "@/pages/FactoryEmployeeAttendanceTab";
import FactoryEmployeeAdvancesTab from "@/pages/FactoryEmployeeAdvancesTab";
import FactoryEmployeeBonusesTab from "@/pages/FactoryEmployeeBonusesTab";

type TabValue = "employees" | "payroll" | "attendance" | "advances" | "bonuses";

function getInitialTab(): TabValue {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  if (tab === "payroll") return "payroll";
  if (tab === "attendance") return "attendance";
  if (tab === "advances") return "advances";
  if (tab === "bonuses") return "bonuses";
  return "employees";
}

export default function FactoryEmployeesHub() {
  const [tab, setTab] = useState<TabValue>(getInitialTab);

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
      <TabsList className="mb-4 flex flex-wrap gap-1">
        <TabsTrigger value="employees" data-testid="tab-employees">
          <Users className="h-4 w-4 mr-2" />
          Employees
        </TabsTrigger>
        <TabsTrigger value="payroll" data-testid="tab-employee-payroll">
          <DollarSign className="h-4 w-4 mr-2" />
          Payroll
        </TabsTrigger>
        <TabsTrigger value="attendance" data-testid="tab-employee-attendance">
          <CalendarDays className="h-4 w-4 mr-2" />
          Attendance
        </TabsTrigger>
        <TabsTrigger value="advances" data-testid="tab-employee-advances">
          <Banknote className="h-4 w-4 mr-2" />
          Advances
        </TabsTrigger>
        <TabsTrigger value="bonuses" data-testid="tab-employee-bonuses">
          <Gift className="h-4 w-4 mr-2" />
          Bonuses
        </TabsTrigger>
      </TabsList>

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
    </Tabs>
  );
}
