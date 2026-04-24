import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import FactoryContainerLoadingScan from "./FactoryContainerLoadingScan";
import FactoryPendingLoadings from "./FactoryPendingLoadings";

export default function FactoryLoadingsHub() {
  const hash = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";

  const { data: settings } = useQuery<any>({
    queryKey: ["/api/factory/settings"],
    queryFn: async () => { const r = await fetch("/api/factory/settings"); return r.ok ? r.json() : {}; },
    staleTime: 60000,
  });

  const { data: myAccess } = useQuery<any>({ queryKey: ["/api/factory/my-access"], staleTime: 60000 });
  const hiddenTabs = myAccess?.hiddenCostFields ?? [];

  const showPending = settings?.loadingsTabPendingEnabled !== false && !hiddenTabs.includes("hide_tab_loadings_pending");

  const defaultTab = hash === "pending" && showPending ? "pending" : "loadings";

  function handleTabChange(value: string) {
    window.history.replaceState(null, "", `#${value}`);
  }

  return (
    <div className="flex flex-col h-full">
      <Tabs defaultValue={defaultTab} onValueChange={handleTabChange} className="flex flex-col h-full">
        <div className="border-b px-4 pt-3 flex-shrink-0">
          <TabsList>
            <TabsTrigger value="loadings" data-testid="tab-container-loadings">Container Loadings</TabsTrigger>
            {showPending && (
              <TabsTrigger value="pending" data-testid="tab-pending-loadings">Pending Loadings</TabsTrigger>
            )}
          </TabsList>
        </div>
        <TabsContent value="loadings" className="flex-1 overflow-auto mt-0">
          <FactoryContainerLoadingScan />
        </TabsContent>
        {showPending && (
          <TabsContent value="pending" className="flex-1 overflow-auto mt-0">
            <FactoryPendingLoadings />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
