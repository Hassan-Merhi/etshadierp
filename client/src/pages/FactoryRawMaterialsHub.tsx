import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ProductionRawStock from "./ProductionRawStock";
import MixBatches from "./MixBatches";

export default function FactoryRawMaterialsHub() {
  const hash = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
  const defaultTab = hash === "mix" ? "mix" : "raw";

  function handleTabChange(value: string) {
    window.history.replaceState(null, "", `#${value}`);
  }

  return (
    <div className="flex flex-col h-full">
      <Tabs defaultValue={defaultTab} onValueChange={handleTabChange} className="flex flex-col h-full">
        <div className="border-b px-4 pt-3 flex-shrink-0">
          <TabsList>
            <TabsTrigger value="raw" data-testid="tab-raw-stock">Raw Stock</TabsTrigger>
            <TabsTrigger value="mix" data-testid="tab-mix-batches">Mix Batches</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="raw" className="flex-1 overflow-auto mt-0">
          <ProductionRawStock />
        </TabsContent>
        <TabsContent value="mix" className="flex-1 overflow-auto mt-0">
          <MixBatches />
        </TabsContent>
      </Tabs>
    </div>
  );
}
