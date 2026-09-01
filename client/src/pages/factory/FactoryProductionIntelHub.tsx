import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, Trash2, Beaker, Ship } from "lucide-react";
import ProductionSummary from "@/pages/factory/ProductionSummary";
import FactoryWaste from "@/pages/factory/FactoryWaste";
import FactoryMixOptimizer from "@/pages/factory/FactoryMixOptimizer";
import FactoryContainerTracking from "@/pages/factory/FactoryContainerTracking";
import { useHubQueryState } from "@/hooks/use-hub-query-state";

type Section = "production-summary" | "waste" | "mix-optimizer" | "container-tracking";
const SECTIONS = ["production-summary", "waste", "mix-optimizer", "container-tracking"] as const;

export default function FactoryProductionIntelHub() {
  const [section, setSection] = useHubQueryState<Section>({
    key: "section",
    allowedValues: SECTIONS,
    defaultValue: "production-summary",
    clearKeys: ["tab"],
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Tabs value={section} onValueChange={(value) => setSection(value as Section)} className="flex flex-col h-full overflow-hidden">
        <div className="border-b px-4 pt-3 flex-shrink-0 overflow-x-auto">
          <TabsList className="flex-nowrap">
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
            <TabsTrigger value="container-tracking" data-testid="tab-production-intel-container-tracking">
              <Ship className="h-4 w-4 mr-2" />
              Container Tracking
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
        <TabsContent value="container-tracking" className="flex-1 overflow-auto mt-0 p-4">
          <FactoryContainerTracking />
        </TabsContent>
      </Tabs>
    </div>
  );
}
