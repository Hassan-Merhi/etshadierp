import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, UserRound } from "lucide-react";
import FactoryCustomers from "@/pages/factory/FactoryCustomers";
import FactorySuppliers from "@/pages/factory/FactorySuppliers";
import { useHubQueryState } from "@/hooks/use-hub-query-state";

type Section = "customers" | "suppliers";
const SECTIONS = ["customers", "suppliers"] as const;

export default function FactoryPartiesHub() {
  const [section, setSection] = useHubQueryState<Section>({
    key: "section",
    allowedValues: SECTIONS,
    defaultValue: "customers",
    clearKeys: ["tab"],
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Tabs value={section} onValueChange={(value) => setSection(value as Section)} className="flex flex-col h-full overflow-hidden">
        <div className="border-b px-4 pt-3 flex-shrink-0 overflow-x-auto">
          <TabsList className="flex-nowrap">
            <TabsTrigger value="customers" data-testid="tab-parties-customers">
              <Users className="h-4 w-4 mr-2" />
              Customers
            </TabsTrigger>
            <TabsTrigger value="suppliers" data-testid="tab-parties-suppliers">
              <UserRound className="h-4 w-4 mr-2" />
              Suppliers
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="customers" className="flex-1 overflow-auto mt-0 p-4">
          <FactoryCustomers />
        </TabsContent>

        <TabsContent value="suppliers" className="flex-1 overflow-auto mt-0 p-4">
          <FactorySuppliers />
        </TabsContent>
      </Tabs>
    </div>
  );
}
