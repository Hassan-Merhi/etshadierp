import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import BalesHistory from "./BalesHistory";
import BarcodeLookup from "../BarcodeLookup";
import { RemoveFromStockTab } from "./BaleStockEntry";
import BaleProducts from "../BaleProducts";
import FactoryBaleImportHistory from "./FactoryBaleImportHistory";
import { History, ShieldAlert } from "lucide-react";

export default function FactoryBalesHub() {
  const hash = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";

  const [balesView, setBalesView] = useState<"history" | "remove">(
    hash === "remove" ? "remove" : "history"
  );

  const { data: settings } = useQuery<any>({
    queryKey: ["/api/factory/settings"],
    queryFn: async () => { const r = await fetch("/api/factory/settings"); return r.ok ? r.json() : {}; },
    staleTime: 60000,
  });

  const { data: myAccess } = useQuery<any>({ queryKey: ["/api/factory/my-access"], staleTime: 60000 });
  const hiddenTabs = myAccess?.hiddenCostFields ?? [];

  const showBarcode = settings?.balesTabBarcodeEnabled !== false && !hiddenTabs.includes("hide_tab_bales_barcode");
  const showRemove  = settings?.balesTabRemoveEnabled  !== false && !hiddenTabs.includes("hide_tab_bales_remove");

  const defaultTab = hash === "imports" ? "imports" : hash === "products" ? "products" : hash === "barcode" && showBarcode ? "barcode" : "history";

  function handleTabChange(value: string) {
    window.history.replaceState(null, "", `#${value}`);
  }

  return (
    <div className="flex flex-col h-full">
      <Tabs defaultValue={defaultTab} onValueChange={handleTabChange} className="flex flex-col h-full">
        <div className="border-b px-4 pt-3 flex-shrink-0 flex items-end gap-4">
          <TabsList>
            <TabsTrigger value="history" data-testid="tab-bales-history">Bales</TabsTrigger>
            {showBarcode && (
              <TabsTrigger value="barcode" data-testid="tab-barcode-lookup">Barcode Lookup</TabsTrigger>
            )}
            <TabsTrigger value="products" data-testid="tab-bale-products">Bale Products</TabsTrigger>
            <TabsTrigger value="imports" data-testid="tab-import-history">Import History</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="history" className="flex-1 overflow-auto mt-0 flex flex-col">
          {showRemove && (
            <div className="flex items-center gap-1 border-b px-4 py-2 flex-shrink-0">
              <Button
                variant={balesView === "history" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setBalesView("history")}
                data-testid="button-view-history"
              >
                <History className="h-4 w-4 mr-1.5" />
                All Bales
              </Button>
              <Button
                variant={balesView === "remove" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setBalesView("remove")}
                data-testid="button-view-remove"
              >
                <ShieldAlert className="h-4 w-4 mr-1.5" />
                In Stock / Remove
              </Button>
            </div>
          )}
          <div className="flex-1 overflow-auto p-4">
            {balesView === "history" || !showRemove ? (
              <BalesHistory />
            ) : (
              <RemoveFromStockTab />
            )}
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

        <TabsContent value="imports" className="flex-1 overflow-auto mt-0">
          <FactoryBaleImportHistory />
        </TabsContent>
      </Tabs>
    </div>
  );
}
