import { useSearch, useLocation } from "wouter";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Package, Search, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import StockItems from "@/pages/StockItems";
import StockQuery from "@/pages/StockQuery";
import OffloadItemSearch from "@/pages/OffloadItemSearch";
import { GradesCategoriesManager } from "@/components/GradesCategoriesManager";

const TABS = [
  { value: "items",   label: "Items",          icon: Package },
  { value: "query",   label: "Query",          icon: Search },
  { value: "offload", label: "Offload Search",  icon: Truck },
];

export default function StockHub() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const tab = new URLSearchParams(search).get("tab") || "items";

  const setTab = (t: string) => navigate(`/stock?tab=${t}`, { replace: true });

  return (
    <div>
      <Tabs value={tab} onValueChange={setTab}>
        {/* Custom segment strip */}
        <div className="flex flex-wrap gap-1 p-1 rounded-xl border bg-card mb-5 w-fit">
          {TABS.map(({ value, label, icon: Icon }) => {
            const isActive = tab === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                data-testid={`tab-stock-${value}`}
                className={cn(
                  "inline-flex items-center gap-2 px-4 h-9 rounded-lg text-sm transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground font-normal"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </button>
            );
          })}
        </div>

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
