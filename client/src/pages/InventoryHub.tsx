import { useSearch, useLocation } from "wouter";
import { MapPin, Ship, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import LocationInventory from "@/pages/LocationInventory";
import StockOTW from "@/pages/StockOTW";
import Containers from "@/pages/ContainersPage";

const TABS = [
  { value: "by-location", label: "By Location", icon: MapPin },
  { value: "on-the-way", label: "On The Way", icon: Ship },
  { value: "containers", label: "Containers", icon: Package },
];

export default function InventoryHub() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const activeTab = new URLSearchParams(search).get("tab") || "by-location";

  const setTab = (tab: string) => navigate(`/inventory?tab=${tab}`, { replace: true });

  return (
    <div>
      <div className="flex flex-wrap gap-1 p-1 rounded-xl border bg-card mb-5 w-fit h-auto">
        {TABS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            data-testid={`tab-${value}`}
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

      {activeTab === "by-location" && <LocationInventory />}
      {activeTab === "on-the-way" && <StockOTW />}
      {activeTab === "containers" && <Containers />}
    </div>
  );
}
