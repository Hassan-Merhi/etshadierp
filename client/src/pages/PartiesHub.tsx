import { Suspense, lazy } from "react";
import { useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Truck, Users } from "lucide-react";

const Suppliers = lazy(() => import("@/pages/Suppliers"));
const Customers  = lazy(() => import("@/pages/Customers"));

const TABS = [
  { key: "suppliers", label: "Suppliers", icon: Truck  },
  { key: "customers", label: "Customers", icon: Users  },
];

export default function PartiesHub() {
  const [, setLocation] = useLocation();
  const search   = useSearch();
  const params   = new URLSearchParams(search);
  const tabParam = params.get("tab") ?? "";
  const activeTab = TABS.find(t => t.key === tabParam) ? tabParam : "suppliers";

  const setTab = (key: string) => setLocation("/parties?tab=" + key);

  return (
    <div className="flex flex-col h-full">
      <Tabs value={activeTab} onValueChange={setTab} className="flex flex-col h-full">
        <div className="border-b bg-background px-4 pt-3">
          <TabsList className="h-9">
            {TABS.map(t => (
              <TabsTrigger key={t.key} value={t.key} className="flex items-center gap-1.5 text-sm">
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {TABS.map(t => (
          <TabsContent key={t.key} value={t.key} className="flex-1 overflow-auto m-0 p-0">
            <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}>
              {t.key === "suppliers" && <Suppliers />}
              {t.key === "customers" && <Customers />}
            </Suspense>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
