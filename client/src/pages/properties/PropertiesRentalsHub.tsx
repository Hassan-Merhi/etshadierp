import { Building2, ClipboardList, Store } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useHubQueryState } from "@/hooks/use-hub-query-state";
import PropertiesRentalWarehouses from "./PropertiesRentalWarehouses";
import PropertiesRentalShops from "./PropertiesRentalShops";
import PropertiesRentalPayments from "./PropertiesRentalPayments";

const RENTAL_TABS = ["warehouses", "shops", "payments"] as const;
type RentalTab = (typeof RENTAL_TABS)[number];

export default function PropertiesRentalsHub() {
  const [tab, setTab] = useHubQueryState<RentalTab>({
    key: "tab",
    allowedValues: RENTAL_TABS,
    defaultValue: "warehouses",
    omitDefault: true,
  });

  return (
    <div className="space-y-4" data-testid="properties-rentals-hub">
      <Tabs value={tab} onValueChange={(value) => setTab(value as RentalTab)}>
        <TabsList className="grid w-full max-w-2xl grid-cols-3">
          <TabsTrigger value="warehouses" data-testid="tab-properties-rentals-warehouses">
            <Building2 className="mr-2 h-4 w-4" />
            Warehouses
          </TabsTrigger>
          <TabsTrigger value="shops" data-testid="tab-properties-rentals-shops">
            <Store className="mr-2 h-4 w-4" />
            Shops
          </TabsTrigger>
          <TabsTrigger value="payments" data-testid="tab-properties-rentals-payments">
            <ClipboardList className="mr-2 h-4 w-4" />
            Payments
          </TabsTrigger>
        </TabsList>

        <TabsContent value="warehouses" className="mt-4">
          <PropertiesRentalWarehouses />
        </TabsContent>
        <TabsContent value="shops" className="mt-4">
          <PropertiesRentalShops />
        </TabsContent>
        <TabsContent value="payments" className="mt-4">
          <PropertiesRentalPayments />
        </TabsContent>
      </Tabs>
    </div>
  );
}
