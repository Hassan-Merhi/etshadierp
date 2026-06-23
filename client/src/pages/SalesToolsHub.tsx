import { Suspense, lazy } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Book, ArrowLeftRight, Tag } from "lucide-react";
import { cn } from "@/lib/utils";

const POSDaybook = lazy(() => import("@/pages/pos/POSDaybook"));
const StockTransfers = lazy(() => import("@/pages/StockTransfers"));
const POSPriceList = lazy(() => import("@/pages/pos/POSPriceList"));

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
        { key: "daybook", label: "POS Daybook", icon: Book },
        { key: "transfers", label: "Stock Transfers", icon: ArrowLeftRight },
      ]
    : [
        { key: "transfers", label: "Stock Transfers", icon: ArrowLeftRight },
        { key: "pricelist", label: "Price List", icon: Tag },
      ];

  const defaultTab = tabs[0].key;
  const activeTab = tabs.find((t) => t.key === tabParam) ? tabParam : defaultTab;

  const setTab = (key: string) => setLocation("/sales-tools?tab=" + key);

  return (
    <div className="flex flex-col h-full">
      <Tabs value={activeTab} onValueChange={setTab} className="flex flex-col h-full">
        {/* Tab strip header */}
        <div className="border-b bg-background px-4 py-2.5 shrink-0">
          <div className="flex gap-1 p-1 rounded-xl border bg-card w-fit">
            {tabs.map((t) => {
              const isActive = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  data-testid={`tab-${t.key}`}
                  className={cn(
                    "inline-flex items-center gap-2 px-4 h-9 rounded-lg text-sm transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground font-normal"
                  )}
                >
                  <t.icon className="h-4 w-4 shrink-0" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {tabs.map((t) => (
          <TabsContent key={t.key} value={t.key} className="flex-1 overflow-auto m-0 p-0">
            <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}>
              {t.key === "daybook" && <POSDaybook />}
              {t.key === "transfers" && <StockTransfers hideVoucherNotes />}
              {t.key === "pricelist" && <POSPriceList />}
            </Suspense>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
