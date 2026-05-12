import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Container, Ship } from "lucide-react";
import FactoryContainers from "@/pages/factory/FactoryContainers";
import FactoryStockOTW from "@/pages/factory/FactoryStockOTW";

type Section = "containers" | "stock-otw";

function getInitialSection(): Section {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const s = params.get("section");
    if (s === "stock-otw") return "stock-otw";
  }
  return "containers";
}

function setSectionInUrl(section: Section) {
  const url = new URL(window.location.href);
  url.searchParams.set("section", section);
  url.searchParams.delete("tab");
  window.history.replaceState(null, "", url.toString());
}

export default function FactoryContainersHub() {
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
            <TabsTrigger value="containers" data-testid="tab-containers-hub-containers">
              <Container className="h-4 w-4 mr-2" />
              Containers
            </TabsTrigger>
            <TabsTrigger value="stock-otw" data-testid="tab-containers-hub-stock-otw">
              <Ship className="h-4 w-4 mr-2" />
              Stock OTW
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="containers" className="flex-1 overflow-auto mt-0 p-4">
          <FactoryContainers />
        </TabsContent>

        <TabsContent value="stock-otw" className="flex-1 overflow-auto mt-0 p-4">
          <FactoryStockOTW />
        </TabsContent>
      </Tabs>
    </div>
  );
}
