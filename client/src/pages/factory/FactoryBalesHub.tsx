import { useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BalesHistory from "./BalesHistory";
import BarcodeLookup from "../BarcodeLookup";
import { RemoveFromStockTab } from "./BaleStockEntry";

export default function FactoryBalesHub() {
  const [location, setLocation] = useLocation();
  const hash = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
  const defaultTab = hash === "barcode" ? "barcode" : hash === "remove" ? "remove" : "history";

  function handleTabChange(value: string) {
    window.history.replaceState(null, "", `#${value}`);
  }

  return (
    <div className="flex flex-col h-full">
      <Tabs defaultValue={defaultTab} onValueChange={handleTabChange} className="flex flex-col h-full">
        <div className="border-b px-4 pt-3 flex-shrink-0">
          <TabsList>
            <TabsTrigger value="history" data-testid="tab-bales-history">Bales History</TabsTrigger>
            <TabsTrigger value="barcode" data-testid="tab-barcode-lookup">Barcode Lookup</TabsTrigger>
            <TabsTrigger value="remove" data-testid="tab-remove-from-stock">Remove from Stock</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="history" className="flex-1 overflow-auto mt-0">
          <BalesHistory />
        </TabsContent>
        <TabsContent value="barcode" className="flex-1 overflow-auto mt-0">
          <BarcodeLookup />
        </TabsContent>
        <TabsContent value="remove" className="flex-1 overflow-auto mt-0 p-4">
          <RemoveFromStockTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
