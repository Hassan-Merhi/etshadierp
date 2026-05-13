import { Suspense, lazy } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Book, ArrowLeftRight, Tag } from "lucide-react";

const POSDaybook   = lazy(() => import("@/pages/pos/POSDaybook"));
const StockTransfers = lazy(() => import("@/pages/StockTransfers"));
const POSPriceList  = lazy(() => import("@/pages/pos/POSPriceList"));

export default function SalesToolsHub() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const tabParam = params.get("tab") ?? "";

  const { data: user } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });

  const isPOS = user?.role === "POS";

  const tabs = isPOS
    ? [
        { key: "daybook",   label: "POS Daybook",     icon: Book           },
        { key: "transfers", label: "Stock Transfers",  icon: ArrowLeftRight },
      ]
    : [
        { key: "transfers", label: "Stock Transfers",  icon: ArrowLeftRight },
        { key: "pricelist", label: "Price List",       icon: Tag            },
      ];

  const defaultTab = tabs[0].key;
  const activeTab  = tabs.find(t => t.key === tabParam) ? tabParam : defaultTab;

  const setTab = (key: string) => setLocation("/sales-tools?tab=" + key);

  return (
    <div className="flex flex-col h-full">
      <Tabs value={activeTab} onValueChange={setTab} className="flex flex-col h-full">
        <div className="border-b bg-background px-4 pt-3">
          <TabsList className="h-9">
            {tabs.map(t => (
              <TabsTrigger key={t.key} value={t.key} className="flex items-center gap-1.5 text-sm">
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {tabs.map(t => (
          <TabsContent key={t.key} value={t.key} className="flex-1 overflow-auto m-0 p-0">
            <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}>
              {t.key === "daybook"   && <POSDaybook />}
              {t.key === "transfers" && <StockTransfers hideVoucherNotes />}
              {t.key === "pricelist" && <POSPriceList />}
            </Suspense>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
