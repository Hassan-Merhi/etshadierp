import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HardHat, DollarSign, CalendarDays, Banknote, Gift, BarChart3 } from "lucide-react";
import FactoryWorkers from "@/pages/factory/FactoryWorkers";
import FactoryPayrollTab from "@/pages/factory/FactoryPayrollTab";
import FactoryAttendance from "@/pages/factory/FactoryAttendance";
import FactoryAdvancesTab from "@/pages/factory/FactoryAdvancesTab";
import FactoryWorkerBonusesTab from "@/pages/factory/FactoryWorkerBonusesTab";
import FactoryWorkerAttendanceReport from "@/pages/factory/FactoryWorkerAttendanceReport";

type TabValue = "workers" | "payroll" | "attendance" | "report" | "advances" | "bonuses";

const ALL_TAB_OPTIONS: {
  value: TabValue;
  label: string;
  icon: React.ElementType;
  settingKey?: string;
  hiddenKey?: string;
}[] = [
  { value: "workers", label: "Workers", icon: HardHat },
  {
    value: "payroll",
    label: "Payroll",
    icon: DollarSign,
    settingKey: "workersTabPayrollEnabled",
    hiddenKey: "hide_tab_workers_payroll",
  },
  {
    value: "attendance",
    label: "Attendance",
    icon: CalendarDays,
    settingKey: "workersTabAttendanceEnabled",
    hiddenKey: "hide_tab_workers_attendance",
  },
  {
    value: "report",
    label: "Report",
    icon: BarChart3,
    settingKey: "workersTabReportEnabled",
    hiddenKey: "hide_tab_workers_report",
  },
  {
    value: "advances",
    label: "Advances",
    icon: Banknote,
    settingKey: "workersTabAdvancesEnabled",
    hiddenKey: "hide_tab_workers_advances",
  },
  {
    value: "bonuses",
    label: "Bonuses",
    icon: Gift,
    settingKey: "workersTabBonusesEnabled",
    hiddenKey: "hide_tab_workers_bonuses",
  },
];

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
    queryFn: async () => {
      const r = await fetch("/api/factory/settings");
      return r.ok ? r.json() : {};
    },
    staleTime: 60000,
  });

  const { data: myAccess } = useQuery<any>({ queryKey: ["/api/factory/my-access"], staleTime: 5 * 60000 });
  const hiddenTabs = myAccess?.hiddenCostFields ?? [];

  const visibleOptions = ALL_TAB_OPTIONS.filter(({ settingKey, hiddenKey }) => {
    if (!settingKey) return true;
    if (settings && settings[settingKey] === false) return false;
    if (hiddenKey && hiddenTabs.includes(hiddenKey)) return false;
    return true;
  });

  const handleTabChange = (v: string) => {
    const newTab = v as TabValue;
    setTab(newTab);
    setTabInUrl(newTab);
  };

  const current = visibleOptions.find((o) => o.value === tab) ?? visibleOptions[0];
  const Icon = current?.icon ?? HardHat;

  return (
    <Tabs value={tab} onValueChange={handleTabChange}>
      <div className="mb-4">
        <Select value={tab} onValueChange={handleTabChange}>
          <SelectTrigger className="w-52" data-testid="select-workers-section">
            <SelectValue>
              <span className="flex items-center gap-2">
                <Icon className="h-4 w-4 shrink-0" />
                {current?.label}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {visibleOptions.map(({ value, label, icon: ItemIcon }) => (
              <SelectItem key={value} value={value} data-testid={`option-workers-${value}`}>
                <span className="flex items-center gap-2">
                  <ItemIcon className="h-4 w-4 shrink-0" />
                  {label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <TabsContent value="workers" className="mt-0">
        <FactoryWorkers />
      </TabsContent>
      <TabsContent value="payroll" className="mt-0">
        <FactoryPayrollTab />
      </TabsContent>
      <TabsContent value="attendance" className="mt-0">
        <FactoryAttendance />
      </TabsContent>
      <TabsContent value="report" className="mt-0">
        <FactoryWorkerAttendanceReport />
      </TabsContent>
      <TabsContent value="advances" className="mt-0">
        <FactoryAdvancesTab />
      </TabsContent>
      <TabsContent value="bonuses" className="mt-0">
        <FactoryWorkerBonusesTab />
      </TabsContent>
    </Tabs>
  );
}
