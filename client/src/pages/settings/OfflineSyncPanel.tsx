  import { useState, useEffect, useRef } from "react";
  import { OFFLINE_MODE_ENABLED } from "@/lib/featureFlags";
  import { useConnectivity } from "@/contexts/ConnectivityContext";
  import { DeleteConfirmDialog } from "@/components/ConfirmationDialog";
  import { OfflinePrepPanel } from "@/components/OfflinePrepPanel";
  import { useForm } from "react-hook-form";
  import { zodResolver } from "@hookform/resolvers/zod";
  import { z } from "zod";
  import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
  } from "@/components/ui/dialog";
  import { Alert, AlertDescription } from "@/components/ui/alert";
  import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
  } from "@/components/ui/alert-dialog";
  import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
  } from "@/components/ui/form";
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from "@/components/ui/select";
  import { Checkbox } from "@/components/ui/checkbox";
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from "@/components/ui/table";
  import { Badge } from "@/components/ui/badge";
  import { Skeleton } from "@/components/ui/skeleton";
  import { Switch } from "@/components/ui/switch";
  
  import { useToast } from "@/hooks/use-toast";
  import { useMutation, useQuery } from "@tanstack/react-query";
  import { queryClient, apiRequest } from "@/lib/queryClient";
  import { useAppMode } from "@/contexts/AppModeContext";
  import { getApiRequest, factoryApiRequest } from "@/lib/factoryApi";
  import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
  import { Plus, Edit, Building2, Users, ChevronDown, ChevronUp, Trash2, CalendarRange, Settings2, Wrench, MapPin, ChevronRight, Bot, MessageCircle, RefreshCw, Calculator, Loader2, Shield, AlertTriangle, PieChart, Key, Lock, Package, Eye, History, Clock, Upload, Download, Database, TrendingUp, ShoppingCart, Check, X, Copy, ExternalLink, ArrowLeftRight, WifiOff, Wifi, CheckCircle2, Printer, Layers } from "lucide-react";
import { utils, writeFile, readFile, read, ExcelJS } from "@/lib/excelHelper";
  import { Link } from "wouter";
  import { useDateFormat } from "@/contexts/DateFormatContext";
  import { insertUserSchema, insertCompanySchema, insertUserCompanyRoleSchema, FEATURE_KEYS, FEATURE_PAGE_INFO, type FeatureKey } from "@shared/schema";
  import { FACTORY_NAV_PAGES } from "@/components/FactorySidebar";
  import { FiscalPeriodTab } from "@/components/FiscalPeriodTab";
  import { useCompany } from "@/contexts/CompanyContext";
  import { ExchangeRateSettings } from "@/components/ExchangeRateSettings";
  import { formatNumber } from "@/lib/formatNumber";
  
  const userFormSchema = insertUserSchema;
  const companyFormSchema = insertCompanySchema;
  const roleAssignmentSchema = insertUserCompanyRoleSchema.refine(
    (data) => {
      // If role is POS, assignedLocationId must be present
      if (data.role === "POS" && !data.assignedLocationId) {
        return false;
      }
      return true;
    },
    {
      message: "POS roles require an assigned location",
      path: ["assignedLocationId"],
    }
  );
  
  type UserFormData = z.infer<typeof userFormSchema>;
  type CompanyFormData = z.infer<typeof companyFormSchema>;
  type RoleAssignmentData = z.infer<typeof roleAssignmentSchema>;


export function formatRelativeTime(ts: number): string {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(ts).toLocaleString();
  }

export function OfflineSyncPanel() {
  if (!OFFLINE_MODE_ENABLED) return null;
  const { isOnline, isSyncing, lastSyncedAt, pendingCount, failedCount, conflictCount, triggerSync, refreshCounts } = useConnectivity();
  const { toast } = useToast();
  const [logs, setLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [clearing, setClearing] = useState(false);

  const loadLogs = async () => {
    setLoadingLogs(true);
    try {
      const { getRecentSyncLogs } = await import("@/lib/db");
      const l = await getRecentSyncLogs(30);
      setLogs(l);
    } catch {
      setLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    void loadLogs();
    void refreshCounts();
  }, []);

  const handleSyncNow = () => {
    if (!isOnline) {
      toast({ title: "Offline", description: "Cannot sync while offline.", variant: "destructive" });
      return;
    }
    triggerSync();
    toast({ title: "Sync started", description: "Replaying all pending actions." });
    setTimeout(() => { void loadLogs(); void refreshCounts(); }, 2000);
  };

  const handleClearData = async () => {
    if (!confirm("This will clear all offline IndexedDB data including sync queue and logs. The legacy localStorage queue will remain. Continue?")) return;
    setClearing(true);
    try {
      const { clearAllOfflineData } = await import("@/lib/db");
      await clearAllOfflineData();
      toast({ title: "Cleared", description: "Offline IndexedDB data cleared." });
      void loadLogs();
      void refreshCounts();
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "Failed to clear data.", variant: "destructive" });
    } finally {
      setClearing(false);
    }
  };
  const logTypeColor: Record<string, string> = {
    sync_start: "text-blue-500",
    sync_end: "text-green-500",
    item_success: "text-green-600",
    item_failed: "text-red-500",
    online: "text-green-600",
    offline: "text-amber-500",
    error: "text-destructive",
  };

  return (
    <div className="space-y-6" data-testid="section-offline-sync">
      <div className="flex items-center gap-2">
        <WifiOff className="h-5 w-5" />
        <h2 className="text-2xl font-semibold">Offline &amp; Sync</h2>
      </div>

      {/* Status Overview */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${isOnline ? "bg-green-500/10" : "bg-amber-500/10"}`}>
                {isOnline ? <Wifi className="h-5 w-5 text-green-500" /> : <WifiOff className="h-5 w-5 text-amber-500" />}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Connection</p>
                <p className="font-medium text-sm" data-testid="text-connectivity-status">
                  {isSyncing ? "Syncing..." : isOnline ? "Online" : "Offline"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${pendingCount > 0 ? "bg-blue-500/10" : "bg-muted/50"}`}>
                <Clock className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending Actions</p>
                <p className="font-medium text-sm" data-testid="text-pending-count">
                  {pendingCount} pending
                  {failedCount > 0 && (
                    <span className="text-destructive ml-1">
                      · {failedCount} failed
                    </span>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={conflictCount > 0 ? "cursor-pointer hover-elevate" : ""}
          onClick={conflictCount > 0 ? () => window.location.href = "/conflicts" : undefined}
          data-testid="card-conflict-count"
        >
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${conflictCount > 0 ? "bg-orange-500/10" : "bg-muted/50"}`}>
                <AlertTriangle className={`h-5 w-5 ${conflictCount > 0 ? "text-orange-500" : "text-muted-foreground"}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Conflicts</p>
                <p className={`font-medium text-sm ${conflictCount > 0 ? "text-orange-600 dark:text-orange-400" : ""}`} data-testid="text-conflict-count">
                  {conflictCount > 0 ? (
                    <>{conflictCount} unresolved — <span className="underline">review</span></>
                  ) : "None"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Last Synced</p>
                <p className="font-medium text-sm" data-testid="text-last-synced">
                  {lastSyncedAt ? formatRelativeTime(lastSyncedAt) : "Never this session"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sync Controls</CardTitle>
          <CardDescription>Manually trigger a sync or clear offline data stored locally.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button
            onClick={handleSyncNow}
            disabled={isSyncing || !isOnline}
            data-testid="button-manual-sync"
          >
            {isSyncing ? (
              <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Syncing...</>
            ) : (
              <><RefreshCw className="h-4 w-4 mr-2" />Sync Now</>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => { void loadLogs(); void refreshCounts(); }}
            data-testid="button-refresh-offline-panel"
          >
            Refresh
          </Button>
          <Button
            variant="destructive"
            onClick={handleClearData}
            disabled={clearing}
            data-testid="button-clear-offline-data"
          >
            {clearing ? "Clearing..." : "Clear Offline Data"}
          </Button>
        </CardContent>
      </Card>

      {/* Sync Activity Log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" />
            Sync Activity Log
          </CardTitle>
          <CardDescription>Recent sync events (last 30)</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingLogs ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
              Loading logs...
            </div>
          ) : logs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center" data-testid="text-no-sync-logs">
              No sync activity recorded yet.
            </div>
          ) : (
            <div className="space-y-1 font-mono text-xs">
              {logs.map((log) => (
                <div key={log.id} className="flex items-start gap-2 py-1 border-b last:border-0">
                  <span className="text-muted-foreground shrink-0 min-w-[80px]">
                    {formatRelativeTime(log.timestamp)}
                  </span>
                  <span className={`shrink-0 ${logTypeColor[log.type] ?? "text-foreground"}`}>
                    [{log.type}]
                  </span>
                  <span className="truncate text-foreground">{log.message}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

