import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import FactoryContainerLoadingScan from "./FactoryContainerLoadingScan";
import FactoryPendingLoadings from "./FactoryPendingLoadings";

export default function FactoryLoadingsHub() {
  const hash = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
  const defaultTab = hash === "pending" ? "pending" : "loadings";

  function handleTabChange(value: string) {
    window.history.replaceState(null, "", `#${value}`);
  }

  return (
    <div className="flex flex-col h-full">
      <Tabs defaultValue={defaultTab} onValueChange={handleTabChange} className="flex flex-col h-full">
        <div className="border-b px-4 pt-3 flex-shrink-0">
          <TabsList>
            <TabsTrigger value="loadings" data-testid="tab-container-loadings">Container Loadings</TabsTrigger>
            <TabsTrigger value="pending" data-testid="tab-pending-loadings">Pending Loadings</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="loadings" className="flex-1 overflow-auto mt-0">
          <FactoryContainerLoadingScan />
        </TabsContent>
        <TabsContent value="pending" className="flex-1 overflow-auto mt-0">
          <FactoryPendingLoadings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
