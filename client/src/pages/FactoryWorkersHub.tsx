import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HardHat, DollarSign, CalendarDays, Banknote, Users } from "lucide-react";
import FactoryWorkers from "@/pages/FactoryWorkers";
import FactoryPayrollTab from "@/pages/FactoryPayrollTab";
import FactoryAttendance from "@/pages/FactoryAttendance";
import FactoryAdvancesTab from "@/pages/FactoryAdvancesTab";
import FactoryEmployees from "@/pages/FactoryEmployees";

type TabValue = "workers" | "payroll" | "attendance" | "advances" | "employees";

function getInitialTab(): TabValue {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  if (tab === "payroll") return "payroll";
  if (tab === "attendance") return "attendance";
  if (tab === "advances") return "advances";
  if (tab === "employees") return "employees";
  return "workers";
}

export default function FactoryWorkersHub() {
  const [tab, setTab] = useState<TabValue>(getInitialTab);

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
      <TabsList className="mb-4 flex flex-wrap gap-1">
        <TabsTrigger value="workers" data-testid="tab-workers">
          <HardHat className="h-4 w-4 mr-2" />
          Workers
        </TabsTrigger>
        <TabsTrigger value="employees" data-testid="tab-employees">
          <Users className="h-4 w-4 mr-2" />
          Employees
        </TabsTrigger>
        <TabsTrigger value="payroll" data-testid="tab-payroll">
          <DollarSign className="h-4 w-4 mr-2" />
          Payroll
        </TabsTrigger>
        <TabsTrigger value="attendance" data-testid="tab-attendance">
          <CalendarDays className="h-4 w-4 mr-2" />
          Attendance
        </TabsTrigger>
        <TabsTrigger value="advances" data-testid="tab-advances">
          <Banknote className="h-4 w-4 mr-2" />
          Advances
        </TabsTrigger>
      </TabsList>

      <TabsContent value="workers" className="mt-0">
        <FactoryWorkers />
      </TabsContent>
      <TabsContent value="employees" className="mt-0">
        <FactoryEmployees />
      </TabsContent>
      <TabsContent value="payroll" className="mt-0">
        <FactoryPayrollTab />
      </TabsContent>
      <TabsContent value="attendance" className="mt-0">
        <FactoryAttendance />
      </TabsContent>
      <TabsContent value="advances" className="mt-0">
        <FactoryAdvancesTab />
      </TabsContent>
    </Tabs>
  );
}
