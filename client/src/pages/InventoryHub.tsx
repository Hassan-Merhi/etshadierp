import { useSearch, useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MapPin, Ship, Package } from "lucide-react";
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
        <TabsList className="flex flex-wrap gap-1 p-1 rounded-xl border bg-card mb-5 w-fit h-auto">
          {TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              data-testid={`tab-${value}`}
              className="inline-flex items-center gap-2 px-4 h-9 rounded-lg text-sm font-normal transition-colors data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none data-[state=active]:font-medium"
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

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
