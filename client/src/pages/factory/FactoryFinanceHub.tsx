import { Suspense, lazy } from "react";
import { useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HardHat, Users, UserRound, FileText, Landmark } from "lucide-react";

const FactoryWorkersHub   = lazy(() => import("@/pages/factory/FactoryWorkersHub"));
const FactoryEmployeesHub = lazy(() => import("@/pages/factory/FactoryEmployeesHub"));
const FactorySuppliers    = lazy(() => import("@/pages/factory/FactorySuppliers"));
const FactoryVouchers     = lazy(() => import("@/pages/factory/FactoryVouchers"));
const FactoryAccounts     = lazy(() => import("@/pages/factory/FactoryAccounts"));

const TABS = [
  { key: "workers",   label: "Workers",   icon: HardHat   },
  { key: "employees", label: "Employees", icon: Users      },
  { key: "suppliers", label: "Suppliers", icon: UserRound  },
  { key: "vouchers",  label: "Vouchers",  icon: FileText   },
  { key: "accounts",  label: "Accounts",  icon: Landmark   },
];

export default function FactoryFinanceHub() {
  const [location, setLocation] = useLocation();
  const params    = new URLSearchParams(location.split("?")[1] ?? "");
  const tabParam  = params.get("tab") ?? "";
  const activeTab = TABS.find(t => t.key === tabParam) ? tabParam : "workers";

  const setTab = (key: string) => setLocation("/factory/finance?tab=" + key);

  return (
    <div className="flex flex-col h-full">
      <Tabs value={activeTab} onValueChange={setTab} className="flex flex-col h-full">
        <div className="border-b bg-background px-4 pt-3 overflow-x-auto">
          <TabsList className="h-9 flex-nowrap">
            {TABS.map(t => (
              <TabsTrigger key={t.key} value={t.key} className="flex items-center gap-1.5 text-sm">
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="workers"   className="flex-1 overflow-auto m-0 p-0">
          <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}>
            <FactoryWorkersHub />
          </Suspense>
        </TabsContent>

        <TabsContent value="employees" className="flex-1 overflow-auto m-0 p-0">
          <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}>
            <FactoryEmployeesHub />
          </Suspense>
        </TabsContent>

        <TabsContent value="suppliers" className="flex-1 overflow-auto m-0 p-0">
          <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}>
            <FactorySuppliers />
          </Suspense>
        </TabsContent>

        <TabsContent value="vouchers"  className="flex-1 overflow-auto m-0 p-0">
          <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}>
            <FactoryVouchers />
          </Suspense>
        </TabsContent>

        <TabsContent value="accounts"  className="flex-1 overflow-auto m-0 p-0">
          <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}>
            <FactoryAccounts />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
