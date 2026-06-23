import { useSearch, useLocation } from "wouter";
import { Tabs, TabsContent } from "@/components/ui/tabs";
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
  const tab = new URLSearchParams(search).get("tab") || "by-location";

  const setTab = (t: string) => navigate(`/inventory?tab=${t}`, { replace: true });

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
                data-testid={`tab-${value}`}
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

        <TabsContent value="by-location">
          <LocationInventory />
        </TabsContent>

        <TabsContent value="on-the-way">
          <StockOTW />
        </TabsContent>

        <TabsContent value="containers">
          <Containers />
        </TabsContent>
      </Tabs>
    </div>
  );
}
