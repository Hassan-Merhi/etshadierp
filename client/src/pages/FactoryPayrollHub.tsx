import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HardHat, DollarSign, CalendarDays, Banknote, Gift, Users, ArrowDownCircle } from "lucide-react";
import FactoryWorkers from "@/pages/FactoryWorkers";
import FactoryPayrollTab from "@/pages/FactoryPayrollTab";
import FactoryAttendance from "@/pages/FactoryAttendance";
import FactoryAdvancesTab from "@/pages/FactoryAdvancesTab";
import FactoryWorkerBonusesTab from "@/pages/FactoryWorkerBonusesTab";
import FactoryEmployees from "@/pages/FactoryEmployees";
import FactoryEmployeePayrollTab from "@/pages/FactoryEmployeePayrollTab";
import FactoryEmployeeAttendanceTab from "@/pages/FactoryEmployeeAttendanceTab";
import FactoryEmployeeAdvancesTab from "@/pages/FactoryEmployeeAdvancesTab";
import FactoryEmployeeBonusesTab from "@/pages/FactoryEmployeeBonusesTab";
import FactoryEmployeeWithdrawalsTab from "@/pages/FactoryEmployeeWithdrawalsTab";

type Section = "workers" | "employees";
type WorkerTab = "workers" | "payroll" | "attendance" | "advances" | "bonuses";
type EmployeeTab = "employees" | "payroll" | "attendance" | "advances" | "bonuses" | "withdrawals";

function readParam<T extends string>(key: string, fallback: T, valid: T[]): T {
  const v = new URLSearchParams(window.location.search).get(key) as T;
  return valid.includes(v) ? v : fallback;
}

function patchUrl(updates: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(updates)) {
    if (v == null) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  window.history.replaceState(null, "", url.toString());
}

export default function FactoryPayrollHub() {
  const [section, setSection] = useState<Section>(() =>
    readParam("section", "workers", ["workers", "employees"])
  );
  const [workerTab, setWorkerTab] = useState<WorkerTab>(() =>
    readParam("tab", "workers", ["workers", "payroll", "attendance", "advances", "bonuses"])
  );
  const [employeeTab, setEmployeeTab] = useState<EmployeeTab>(() =>
    readParam("tab", "employees", ["employees", "payroll", "attendance", "advances", "bonuses", "withdrawals"])
  );

  const switchSection = (s: Section) => {
    setSection(s);
    const defaultTab = s === "workers" ? "workers" : "employees";
    patchUrl({ section: s, tab: null, mode: null });
    if (s === "workers") setWorkerTab("workers");
    else setEmployeeTab("employees");
  };

  const handleWorkerTab = (v: string) => {
    const t = v as WorkerTab;
    setWorkerTab(t);
    patchUrl({
      tab: t === "workers" ? null : t,
      ...(t !== "attendance" ? { mode: null } : {}),
    });
  };

  const handleEmployeeTab = (v: string) => {
    const t = v as EmployeeTab;
    setEmployeeTab(t);
    patchUrl({ tab: t === "employees" ? null : t });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Top section toggle */}
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <button
          onClick={() => switchSection("workers")}
          data-testid="button-section-workers"
          className={`flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            section === "workers"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <HardHat className="h-4 w-4" />
          Workers
        </button>
        <button
          onClick={() => switchSection("employees")}
          data-testid="button-section-employees"
          className={`flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            section === "employees"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Users className="h-4 w-4" />
          Employees
        </button>
      </div>

      {/* Workers section */}
      {section === "workers" && (
        <Tabs value={workerTab} onValueChange={handleWorkerTab}>
          <TabsList className="mb-4 flex flex-wrap gap-1">
            <TabsTrigger value="workers" data-testid="tab-workers">
              <HardHat className="h-4 w-4 mr-2" />
              Workers
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
            <TabsTrigger value="bonuses" data-testid="tab-bonuses">
              <Gift className="h-4 w-4 mr-2" />
              Bonuses
            </TabsTrigger>
          </TabsList>
          <TabsContent value="workers" className="mt-0"><FactoryWorkers /></TabsContent>
          <TabsContent value="payroll" className="mt-0"><FactoryPayrollTab /></TabsContent>
          <TabsContent value="attendance" className="mt-0"><FactoryAttendance /></TabsContent>
          <TabsContent value="advances" className="mt-0"><FactoryAdvancesTab /></TabsContent>
          <TabsContent value="bonuses" className="mt-0"><FactoryWorkerBonusesTab /></TabsContent>
        </Tabs>
      )}

      {/* Employees section */}
      {section === "employees" && (
        <Tabs value={employeeTab} onValueChange={handleEmployeeTab}>
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
            <TabsTrigger value="withdrawals" data-testid="tab-employee-withdrawals">
              <ArrowDownCircle className="h-4 w-4 mr-2" />
              Withdrawals
            </TabsTrigger>
          </TabsList>
          <TabsContent value="employees" className="mt-0"><FactoryEmployees /></TabsContent>
          <TabsContent value="payroll" className="mt-0"><FactoryEmployeePayrollTab /></TabsContent>
          <TabsContent value="attendance" className="mt-0"><FactoryEmployeeAttendanceTab /></TabsContent>
          <TabsContent value="advances" className="mt-0"><FactoryEmployeeAdvancesTab /></TabsContent>
          <TabsContent value="bonuses" className="mt-0"><FactoryEmployeeBonusesTab /></TabsContent>
          <TabsContent value="withdrawals" className="mt-0"><FactoryEmployeeWithdrawalsTab /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}
