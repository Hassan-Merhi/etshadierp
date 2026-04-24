import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HardHat, DollarSign, CalendarDays, Banknote, Gift, BarChart3 } from "lucide-react";
import FactoryWorkers from "@/pages/factory/FactoryWorkers";
import FactoryPayrollTab from "@/pages/factory/FactoryPayrollTab";
import FactoryAttendance from "@/pages/factory/FactoryAttendance";
import FactoryAdvancesTab from "@/pages/factory/FactoryAdvancesTab";
import FactoryWorkerBonusesTab from "@/pages/factory/FactoryWorkerBonusesTab";
import FactoryWorkerAttendanceReport from "@/pages/factory/FactoryWorkerAttendanceReport";

type TabValue = "workers" | "payroll" | "attendance" | "report" | "advances" | "bonuses";

function getInitialTab(): TabValue {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  if (tab === "payroll") return "payroll";
  if (tab === "attendance") return "attendance";
  if (tab === "report") return "report";
  if (tab === "advances") return "advances";
  if (tab === "bonuses") return "bonuses";
  return "workers";
}

function setTabInUrl(tab: TabValue) {
  const url = new URL(window.location.href);
  if (tab === "workers") {
    url.searchParams.delete("tab");
  } else {
    url.searchParams.set("tab", tab);
  }
  if (tab !== "attendance") {
    url.searchParams.delete("mode");
  }
  window.history.replaceState(null, "", url.toString());
}

export default function FactoryWorkersHub() {
  const [tab, setTab] = useState<TabValue>(getInitialTab);

  const { data: settings } = useQuery<any>({
    queryKey: ["/api/factory/settings"],
    queryFn: async () => { const r = await fetch("/api/factory/settings"); return r.ok ? r.json() : {}; },
    staleTime: 60000,
  });

  const { data: myAccess } = useQuery<any>({ queryKey: ["/api/factory/my-access"], staleTime: 60000 });
  const hiddenTabs = myAccess?.hiddenCostFields ?? [];

  const showPayroll    = settings?.workersTabPayrollEnabled    !== false && !hiddenTabs.includes("hide_tab_workers_payroll");
  const showAttendance = settings?.workersTabAttendanceEnabled !== false && !hiddenTabs.includes("hide_tab_workers_attendance");
  const showReport     = settings?.workersTabReportEnabled     !== false && !hiddenTabs.includes("hide_tab_workers_report");
  const showAdvances   = settings?.workersTabAdvancesEnabled   !== false && !hiddenTabs.includes("hide_tab_workers_advances");
  const showBonuses    = settings?.workersTabBonusesEnabled    !== false && !hiddenTabs.includes("hide_tab_workers_bonuses");

  const handleTabChange = (v: string) => {
    const newTab = v as TabValue;
    setTab(newTab);
    setTabInUrl(newTab);
  };

  return (
    <Tabs value={tab} onValueChange={handleTabChange}>
      <TabsList className="mb-4 flex flex-wrap gap-1">
        <TabsTrigger value="workers" data-testid="tab-workers">
          <HardHat className="h-4 w-4 mr-2" />
          Workers
        </TabsTrigger>
        {showPayroll && (
          <TabsTrigger value="payroll" data-testid="tab-payroll">
            <DollarSign className="h-4 w-4 mr-2" />
            Payroll
          </TabsTrigger>
        )}
        {showAttendance && (
          <TabsTrigger value="attendance" data-testid="tab-attendance">
            <CalendarDays className="h-4 w-4 mr-2" />
            Attendance
          </TabsTrigger>
        )}
        {showReport && (
          <TabsTrigger value="report" data-testid="tab-attendance-report">
            <BarChart3 className="h-4 w-4 mr-2" />
            Report
          </TabsTrigger>
        )}
        {showAdvances && (
          <TabsTrigger value="advances" data-testid="tab-advances">
            <Banknote className="h-4 w-4 mr-2" />
            Advances
          </TabsTrigger>
        )}
        {showBonuses && (
          <TabsTrigger value="bonuses" data-testid="tab-bonuses">
            <Gift className="h-4 w-4 mr-2" />
            Bonuses
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="workers" className="mt-0">
        <FactoryWorkers />
      </TabsContent>
      {showPayroll && (
        <TabsContent value="payroll" className="mt-0">
          <FactoryPayrollTab />
        </TabsContent>
      )}
      {showAttendance && (
        <TabsContent value="attendance" className="mt-0">
          <FactoryAttendance />
        </TabsContent>
      )}
      {showReport && (
        <TabsContent value="report" className="mt-0">
          <FactoryWorkerAttendanceReport />
        </TabsContent>
      )}
      {showAdvances && (
        <TabsContent value="advances" className="mt-0">
          <FactoryAdvancesTab />
        </TabsContent>
      )}
      {showBonuses && (
        <TabsContent value="bonuses" className="mt-0">
          <FactoryWorkerBonusesTab />
        </TabsContent>
      )}
    </Tabs>
  );
}
