import { useSearch, useLocation } from "wouter";
import { Package, Search, Truck, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import StockItems from "@/pages/StockItems";
import StockQuery from "@/pages/StockQuery";
import OffloadItemSearch from "@/pages/OffloadItemSearch";
import { GradesCategoriesManager } from "@/components/GradesCategoriesManager";

const TABS = [
  { value: "items", label: "Items", icon: Package },
  { value: "query", label: "Query", icon: Search },
  { value: "offload", label: "Offload Search", icon: Truck },
  { value: "grades", label: "Grades & Categories", icon: Tag },
];

export default function StockHub() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const activeTab = new URLSearchParams(search).get("tab") || "items";

  const setTab = (tab: string) => navigate(`/stock?tab=${tab}`, { replace: true });

  return (
    <div>
      <div className="flex flex-wrap gap-1 p-1 rounded-xl border bg-card mb-5 w-fit h-auto">
        {TABS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            data-testid={`tab-stock-${value}`}
            onClick={() => setTab(value)}
            className={cn(
              "inline-flex items-center gap-2 px-4 h-9 rounded-lg text-sm font-normal transition-colors",
              activeTab === value
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === "items" && <StockItems />}
      {activeTab === "query" && <StockQuery />}
      {activeTab === "offload" && <OffloadItemSearch />}
      {activeTab === "grades" && <GradesCategoriesManager />}
    </div>
  );
}
