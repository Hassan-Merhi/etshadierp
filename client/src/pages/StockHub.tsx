import { useSearch, useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Package, Search, Truck } from "lucide-react";
import StockItems from "@/pages/StockItems";
import StockQuery from "@/pages/StockQuery";
import OffloadItemSearch from "@/pages/OffloadItemSearch";
import { GradesCategoriesManager } from "@/components/GradesCategoriesManager";

const TABS = [
  { value: "items", label: "Items", icon: Package },
  { value: "query", label: "Query", icon: Search },
  { value: "offload", label: "Offload Search", icon: Truck },
];

export default function StockHub() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const tab = new URLSearchParams(search).get("tab") || "items";

  const setTab = (t: string) => navigate(`/stock?tab=${t}`, { replace: true });

  return (
    <div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap gap-1 p-1 rounded-xl border bg-card mb-5 w-fit h-auto">
          {TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              data-testid={`tab-stock-${value}`}
              className="inline-flex items-center gap-2 px-4 h-9 rounded-lg text-sm font-normal transition-colors data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none data-[state=active]:font-medium"
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="items">
          <StockItems />
        </TabsContent>

        <TabsContent value="query">
          <StockQuery />
        </TabsContent>

        <TabsContent value="offload">
          <OffloadItemSearch />
        </TabsContent>

        <TabsContent value="grades">
          <GradesCategoriesManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
