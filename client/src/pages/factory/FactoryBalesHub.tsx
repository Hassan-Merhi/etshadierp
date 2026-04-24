import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BalesHistory from "./BalesHistory";
import BarcodeLookup from "../BarcodeLookup";
import { RemoveFromStockTab } from "./BaleStockEntry";

export default function FactoryBalesHub() {
  const hash = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";

  const { data: settings } = useQuery<any>({
    queryKey: ["/api/factory/settings"],
    queryFn: async () => { const r = await fetch("/api/factory/settings"); return r.ok ? r.json() : {}; },
    staleTime: 60000,
  });

  const showBarcode = settings?.balesTabBarcodeEnabled !== false;
  const showRemove  = settings?.balesTabRemoveEnabled  !== false;

  const defaultTab = hash === "barcode" && showBarcode ? "barcode"
                   : hash === "remove"  && showRemove  ? "remove"
                   : "history";

  function handleTabChange(value: string) {
    window.history.replaceState(null, "", `#${value}`);
  }

  return (
    <div className="flex flex-col h-full">
      <Tabs defaultValue={defaultTab} onValueChange={handleTabChange} className="flex flex-col h-full">
        <div className="border-b px-4 pt-3 flex-shrink-0">
          <TabsList>
            <TabsTrigger value="history" data-testid="tab-bales-history">Bales History</TabsTrigger>
            {showBarcode && (
              <TabsTrigger value="barcode" data-testid="tab-barcode-lookup">Barcode Lookup</TabsTrigger>
            )}
            {showRemove && (
              <TabsTrigger value="remove" data-testid="tab-remove-from-stock">Remove from Stock</TabsTrigger>
            )}
          </TabsList>
        </div>
        <TabsContent value="history" className="flex-1 overflow-auto mt-0">
          <BalesHistory />
        </TabsContent>
        {showBarcode && (
          <TabsContent value="barcode" className="flex-1 overflow-auto mt-0">
            <BarcodeLookup />
          </TabsContent>
        )}
        {showRemove && (
          <TabsContent value="remove" className="flex-1 overflow-auto mt-0 p-4">
            <RemoveFromStockTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
