import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, Trash2, Beaker } from "lucide-react";
import ProductionSummary from "@/pages/factory/ProductionSummary";
import FactoryWaste from "@/pages/factory/FactoryWaste";
import FactoryMixOptimizer from "@/pages/factory/FactoryMixOptimizer";

type Section = "production-summary" | "waste" | "mix-optimizer";

function getInitialSection(): Section {
  if (typeof window !== "undefined") {
    const s = new URLSearchParams(window.location.search).get("section");
    if (s === "waste") return "waste";
    if (s === "mix-optimizer") return "mix-optimizer";
  }
  return "production-summary";
}

function setSectionInUrl(section: Section) {
  const url = new URL(window.location.href);
  url.searchParams.set("section", section);
  url.searchParams.delete("tab");
  window.history.replaceState(null, "", url.toString());
}

export default function FactoryProductionIntelHub() {
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
            <TabsTrigger value="production-summary" data-testid="tab-production-intel-summary">
              <BarChart3 className="h-4 w-4 mr-2" />
              Production Summary
            </TabsTrigger>
            <TabsTrigger value="waste" data-testid="tab-production-intel-waste">
              <Trash2 className="h-4 w-4 mr-2" />
              Waste Tracking
            </TabsTrigger>
            <TabsTrigger value="mix-optimizer" data-testid="tab-production-intel-mix">
              <Beaker className="h-4 w-4 mr-2" />
              Mix Optimizer
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="production-summary" className="flex-1 overflow-auto mt-0 p-4">
          <ProductionSummary />
        </TabsContent>
        <TabsContent value="waste" className="flex-1 overflow-auto mt-0 p-4">
          <FactoryWaste />
        </TabsContent>
        <TabsContent value="mix-optimizer" className="flex-1 overflow-auto mt-0 p-4">
          <FactoryMixOptimizer />
        </TabsContent>
      </Tabs>
    </div>
  );
}
