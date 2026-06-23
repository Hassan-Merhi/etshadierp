import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { 
  ScanLine, List, CalendarDays, Tag, Factory
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { LabelPrintSettings } from "@/components/LabelPrintSettings";

import StockEntryHistory from "../StockEntryHistory";
import GroundScan from "./GroundScan";
import DailyScan from "./DailyScan";

import { StockEntryTab } from "./bale-stock-entry/StockEntryTab";
import { DailyStockSummary } from "./bale-stock-entry/DailyStockSummary";
import { WorkerCategoriesTab } from "./bale-stock-entry/WorkerCategoriesTab";

export default function BaleStockEntry() {
  const todayStr = new Date().toLocaleDateString('en-CA');
  const [summaryDate, setSummaryDate] = useState<string>(todayStr);
  const { toast } = useToast();
  // Track which tabs have ever been activated so we only mount heavy components on demand.
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(() => new Set(["entry"]));
  
  const handleTabChange = (tab: string) =>
    setMountedTabs(prev => prev.has(tab) ? prev : new Set([...prev, tab]));

  const { data: settings } = useQuery<any>({
    queryKey: ["/api/factory/settings"],
    queryFn: async () => { const r = await fetch("/api/factory/settings"); return r.ok ? r.json() : {}; },
    staleTime: 60000,
  });

  const { data: myAccess } = useQuery<any>({ queryKey: ["/api/factory/my-access"], staleTime: 60000 });
  const hiddenTabs = myAccess?.hiddenCostFields ?? [];

  const showEntry      = settings?.stockEntryTabEntryEnabled   !== false && !hiddenTabs.includes("hide_tab_stockentry_entry");
  const showHistory    = settings?.stockEntryTabHistoryEnabled !== false && !hiddenTabs.includes("hide_tab_stockentry_history");
  const showGroundScan = !hiddenTabs.includes("hide_tab_stockentry_ground_scan");
  const showDailyScan  = !hiddenTabs.includes("hide_tab_stockentry_daily_scan");

  const { data: productionSession, refetch: refetchSession } = useQuery<any>({
    queryKey: ["/api/factory/stock-entry/production-session", todayStr],
    queryFn: async () => {
      const r = await fetch(`/api/factory/stock-entry/production-session?date=${todayStr}`);
      return r.ok ? r.json() : null;
    },
    staleTime: 30000,
  });

  const endProductionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/factory/stock-entry/end-production", { date: todayStr });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Failed to end production"); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Production ended", description: "Worker Matrix PDF sent to WhatsApp group." });
      refetchSession();
    },
    onError: (err: any) => {
      toast({ title: "End Production failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500/30 to-emerald-600/10 border border-emerald-500/25 shrink-0">
            <ScanLine className="h-4.5 w-4.5 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">Bale Stock Entry</h1>
            <p className="text-xs text-muted-foreground leading-tight">Scan and record bale production</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LabelPrintSettings />
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold tracking-widest bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25" data-testid="badge-stock-entry">
            <Factory className="h-3 w-3" />
            STOCK ENTRY
          </span>
        </div>
      </div>

      <DailyStockSummary date={summaryDate} />

      <Tabs defaultValue={showEntry ? "entry" : "history"} onValueChange={handleTabChange}>
        <TabsList>
          {showEntry && (
            <TabsTrigger value="entry" data-testid="tab-stock-entry">
              <ScanLine className="h-4 w-4 mr-1" />
              Stock Entry
            </TabsTrigger>
          )}
          {showHistory && (
            <TabsTrigger value="history" data-testid="tab-stock-entry-history">
              <List className="h-4 w-4 mr-1" />
              Stock Entry History
            </TabsTrigger>
          )}
          {showGroundScan && (
            <TabsTrigger value="ground-scan" data-testid="tab-ground-scan">
              <ScanLine className="h-4 w-4 mr-1" />
              Ground Scan
            </TabsTrigger>
          )}
          {showDailyScan && (
            <TabsTrigger value="daily-scan" data-testid="tab-daily-scan">
              <CalendarDays className="h-4 w-4 mr-1" />
              Daily Scan
            </TabsTrigger>
          )}
          <TabsTrigger value="worker-categories" data-testid="tab-worker-categories">
            <Tag className="h-4 w-4 mr-1" />
            Worker Categories
          </TabsTrigger>
        </TabsList>
        {showEntry && (
          <TabsContent value="entry" className="mt-4">
            <StockEntryTab />
          </TabsContent>
        )}
        {showHistory && (
          <TabsContent value="history" className="mt-0 p-0">
            {mountedTabs.has("history") && (
              <StockEntryHistory />
            )}
          </TabsContent>
        )}
        {showGroundScan && (
          <TabsContent value="ground-scan" className="mt-0 p-0">
            {mountedTabs.has("ground-scan") && (
              <GroundScan />
            )}
          </TabsContent>
        )}
        {showDailyScan && (
          <TabsContent value="daily-scan" className="mt-0 p-0">
            {mountedTabs.has("daily-scan") && (
              <DailyScan />
            )}
          </TabsContent>
        )}
        <TabsContent value="worker-categories" className="mt-4">
          {mountedTabs.has("worker-categories") && (
            <WorkerCategoriesTab />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
