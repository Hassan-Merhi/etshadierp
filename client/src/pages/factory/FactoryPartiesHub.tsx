import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, UserRound } from "lucide-react";
import FactoryCustomers from "@/pages/factory/FactoryCustomers";
import FactorySuppliers from "@/pages/factory/FactorySuppliers";

type Section = "customers" | "suppliers";

function getInitialSection(): Section {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const s = params.get("section");
    if (s === "suppliers") return "suppliers";
  }
  return "customers";
}

function setSectionInUrl(section: Section) {
  const url = new URL(window.location.href);
  url.searchParams.set("section", section);
  url.searchParams.delete("tab");
  window.history.replaceState(null, "", url.toString());
}

export default function FactoryPartiesHub() {
  const [section, setSection] = useState<Section>(getInitialSection);

  function handleSectionChange(value: string) {
    const s = value as Section;
    setSection(s);
    setSectionInUrl(s);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Tabs
        value={section}
        onValueChange={handleSectionChange}
        className="flex flex-col h-full overflow-hidden"
      >
        <div className="border-b px-4 pt-3 flex-shrink-0">
          <TabsList>
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
