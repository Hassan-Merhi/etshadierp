import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BalesHistory from "./BalesHistory";
import BarcodeLookup from "../BarcodeLookup";
import BaleProducts from "../BaleProducts";

export default function FactoryBalesHub() {
  const hash = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";

  const { data: settings } = useQuery<any>({
    queryKey: ["/api/factory/settings"],
    queryFn: async () => { const r = await fetch("/api/factory/settings"); return r.ok ? r.json() : {}; },
    staleTime: 60000,
  });

  const { data: myAccess } = useQuery<any>({ queryKey: ["/api/factory/my-access"], staleTime: 60000 });
  const hiddenTabs = myAccess?.hiddenCostFields ?? [];

  const showBarcode = settings?.balesTabBarcodeEnabled !== false && !hiddenTabs.includes("hide_tab_bales_barcode");

  const defaultTab = hash === "products" ? "products" : hash === "barcode" && showBarcode ? "barcode" : "history";

  function handleTabChange(value: string) {
    window.history.replaceState(null, "", `#${value}`);
  }

  return (
    <div className="flex flex-col h-full">
      <Tabs defaultValue={defaultTab} onValueChange={handleTabChange} className="flex flex-col h-full">
        <div className="border-b px-4 pt-3 flex-shrink-0 flex items-end gap-4 overflow-x-auto">
          <TabsList className="flex-nowrap">
            <TabsTrigger value="history" data-testid="tab-bales-history">Bales</TabsTrigger>
            {showBarcode && (
              <TabsTrigger value="barcode" data-testid="tab-barcode-lookup">Barcode Lookup</TabsTrigger>
            )}
            <TabsTrigger value="products" data-testid="tab-bale-products">Bale Products</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="history" className="flex-1 overflow-auto mt-0">
          <div className="p-4">
            <BalesHistory />
          </div>
        </TabsContent>

        {showBarcode && (
          <TabsContent value="barcode" className="flex-1 overflow-auto mt-0">
            <BarcodeLookup />
          </TabsContent>
        )}

        <TabsContent value="products" className="flex-1 overflow-auto mt-0">
          <BaleProducts />
        </TabsContent>
      </Tabs>
    </div>
  );
}
