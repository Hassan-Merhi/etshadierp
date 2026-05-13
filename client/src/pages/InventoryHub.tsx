import { useSearch, useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import LocationInventory from "@/pages/LocationInventory";
import StockOTW from "@/pages/StockOTW";
import Containers from "@/pages/Containers";
import CombinedInventory from "@/pages/CombinedInventory";

export default function InventoryHub() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const tab = new URLSearchParams(search).get("tab") || "by-location";

  const setTab = (t: string) => navigate(`/inventory?tab=${t}`, { replace: true });

  return (
    <div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-5">
          <TabsTrigger value="by-location" data-testid="tab-by-location">By Location</TabsTrigger>
          <TabsTrigger value="on-the-way" data-testid="tab-on-the-way">On The Way</TabsTrigger>
          <TabsTrigger value="combined" data-testid="tab-combined">Combined</TabsTrigger>
          <TabsTrigger value="containers" data-testid="tab-containers">Containers</TabsTrigger>
        </TabsList>

        <TabsContent value="by-location">
          <LocationInventory />
        </TabsContent>

        <TabsContent value="on-the-way">
          <StockOTW />
        </TabsContent>

        <TabsContent value="combined">
          <CombinedInventory />
        </TabsContent>

        <TabsContent value="containers">
          <Containers />
        </TabsContent>
      </Tabs>
    </div>
  );
}
