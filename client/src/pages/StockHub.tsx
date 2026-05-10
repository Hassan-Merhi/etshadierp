import { useSearch, useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import StockItems from "@/pages/StockItems";
import StockQuery from "@/pages/StockQuery";
import OffloadItemSearch from "@/pages/OffloadItemSearch";
import { GradesCategoriesManager } from "@/components/GradesCategoriesManager";

export default function StockHub() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const tab = new URLSearchParams(search).get("tab") || "items";

  const setTab = (t: string) => navigate(`/stock?tab=${t}`, { replace: true });

  return (
    <div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-5">
          <TabsTrigger value="items" data-testid="tab-stock-items">Items</TabsTrigger>
          <TabsTrigger value="query" data-testid="tab-stock-query">Query</TabsTrigger>
          <TabsTrigger value="offload" data-testid="tab-offload-search">Offload Search</TabsTrigger>
          <TabsTrigger value="grades" data-testid="tab-grades-categories">Grades & Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="items">
          <StockItems />
        </TabsContent>

        <TabsContent value="query">
          <StockQuery />
        </TabsContent>

        <TabsContent value="offload">
          <OffloadItemSearch />
        </TabsContent>

        <TabsContent value="grades">
          <GradesCategoriesManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
