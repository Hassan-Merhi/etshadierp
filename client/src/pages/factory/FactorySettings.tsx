import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { factoryApiRequest } from "@/lib/factoryApi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, Search, ArrowRight, CheckCircle, Wrench, Upload, Download, WifiOff, ToggleRight, DollarSign, AlertTriangle, FileSpreadsheet, Images, MessageCircle, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { OfflinePrepPanel } from "@/components/OfflinePrepPanel";
import { ImportBalesTab } from "./bale-stock-entry/ImportBalesTab";
import { PageHeader } from "@/components/PageHeader";

interface Location {
  id: number;
  name: string;
}

interface FactorySettingsData {
  dashboardEnabled: boolean;
  kpisEnabled: boolean;
  profitabilityEnabled: boolean;
  alertsEnabled: boolean;
  supplierScoringEnabled: boolean;
  mixOptimizerEnabled: boolean;
  traceabilityEnabled: boolean;
  balePhotosEnabled: boolean;
  wasteTrackingEnabled: boolean;
  cashflowEnabled: boolean;
  rolesEnabled: boolean;
  netProfitEnabled: boolean;
  productionSummaryEnabled: boolean;
  supplierReportEnabled: boolean;
  supplierStatementEnabled: boolean;
  daybookEnabled: boolean;
  analyticsEnabled: boolean;
  financialSnapshotEnabled: boolean;
  workersTabPayrollEnabled: boolean;
  workersTabAttendanceEnabled: boolean;
  workersTabReportEnabled: boolean;
  workersTabAdvancesEnabled: boolean;
  workersTabBonusesEnabled: boolean;
  balesTabBarcodeEnabled: boolean;
  balesTabRemoveEnabled: boolean;
  loadingsTabPendingEnabled: boolean;
  stockEntryTabEntryEnabled: boolean;
  stockEntryTabHistoryEnabled: boolean;
  advancesTabRepaymentsEnabled: boolean;
  kpisTabWorkerPerformanceEnabled: boolean;
  kpisTabMixEfficiencyEnabled: boolean;
  payrollTabWorkerMasterEnabled: boolean;
  profitabilityTabContainersEnabled: boolean;
  workersTabCategoriesEnabled: boolean;
  workerDetailTabStatementEnabled: boolean;
  workerDetailTabAdvancesEnabled: boolean;
  workerDetailTabBalesEnabled: boolean;
  workerDetailTabDocumentsEnabled: boolean;
  laborCostPerKg: number;
  overheadPerKg: number;
  hideSellingPrice: boolean;
  hideAvgCost: boolean;
}

const defaultSettings: FactorySettingsData = {
  dashboardEnabled: true,
  kpisEnabled: true,
  profitabilityEnabled: true,
  alertsEnabled: true,
  supplierScoringEnabled: true,
  mixOptimizerEnabled: true,
  traceabilityEnabled: true,
  balePhotosEnabled: true,
  wasteTrackingEnabled: true,
  cashflowEnabled: true,
  rolesEnabled: true,
  netProfitEnabled: true,
  productionSummaryEnabled: true,
  supplierReportEnabled: true,
  supplierStatementEnabled: true,
  daybookEnabled: true,
  analyticsEnabled: true,
  financialSnapshotEnabled: true,
  workersTabPayrollEnabled: true,
  workersTabAttendanceEnabled: true,
  workersTabReportEnabled: true,
  workersTabAdvancesEnabled: true,
  workersTabBonusesEnabled: true,
  balesTabBarcodeEnabled: true,
  balesTabRemoveEnabled: true,
  loadingsTabPendingEnabled: true,
  stockEntryTabEntryEnabled: true,
  stockEntryTabHistoryEnabled: true,
  advancesTabRepaymentsEnabled: true,
  kpisTabWorkerPerformanceEnabled: true,
  kpisTabMixEfficiencyEnabled: true,
  payrollTabWorkerMasterEnabled: true,
  profitabilityTabContainersEnabled: true,
  workersTabCategoriesEnabled: true,
  workerDetailTabStatementEnabled: true,
  workerDetailTabAdvancesEnabled: true,
  workerDetailTabBalesEnabled: true,
  workerDetailTabDocumentsEnabled: true,
  laborCostPerKg: 0,
  overheadPerKg: 0,
  hideSellingPrice: false,
  hideAvgCost: false,
};

interface RenamePreviewItem {
  id: number;
  code: string;
  currentName: string;
  newName: string;
}


function RecalculateBaleCostsCard() {
  const { toast } = useToast();
  const [result, setResult] = useState<{ balesUpdated: number } | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      const res = await factoryApiRequest("POST", "/api/factory/raw-stock/recalculate-bale-costs");
      return res.json();
    },
    onSuccess: (data: any) => {
      setResult(data);
      toast({ title: "Done", description: data.message });
    },
    onError: (error: any) => {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-muted-foreground" />
          Recalculate Old Bale Costs
        </CardTitle>
        <CardDescription>
          Updates the cost/kg and total cost on all existing bales to match their mix batch's current blended rate.
          Run this once to fix bales that were pressed before post-offload charges were added to their container.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {result && (
          <p className="text-sm text-muted-foreground">
            Last run: updated {result.balesUpdated} bale(s).
          </p>
        )}
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          data-testid="button-recalculate-bale-costs"
        >
          {mutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wrench className="h-4 w-4 mr-2" />}
          Recalculate Bale Costs
        </Button>
      </CardContent>
    </Card>
  );
}

function MigrateVoucherDescriptionsCard() {
  const { toast } = useToast();
  const [result, setResult] = useState<{ chargesFixed: number; narrationFixed: number } | null>(null);
  const migrateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/factory/migrate-voucher-descriptions");
      return res.json();
    },
    onSuccess: (data: any) => {
      setResult(data);
      toast({ title: "Update complete", description: `Fixed ${data.chargesFixed} charge entries and ${data.narrationFixed} narrations.` });
    },
    onError: (error: any) => {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-muted-foreground" />
          Fix Old Voucher Descriptions
        </CardTitle>
        <CardDescription>
          Updates old charge descriptions to use container numbers, and cleans up auto-generated narrations on payments, receipts, and journals to show only the description you wrote.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {result && (
          <p className="text-sm text-muted-foreground">
            Last run: fixed {result.chargesFixed} charge entries and {result.narrationFixed} narration entries.
          </p>
        )}
        <Button
          onClick={() => migrateMutation.mutate()}
          disabled={migrateMutation.isPending}
          data-testid="button-migrate-voucher-descriptions"
        >
          {migrateMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wrench className="h-4 w-4 mr-2" />}
          Run Update
        </Button>
      </CardContent>
    </Card>
  );
}

interface WaChat { id: string; name: string; type: string; }

export default function FactorySettings() {
  const { toast } = useToast();
  const { data: currentUser } = useQuery<{ role?: string }>({ queryKey: ["/api/auth/me"] });
  const isDeveloper = currentUser?.role === "Developer";
  const [settings, setSettings] = useState<FactorySettingsData>(defaultSettings);

  const [prodWaGroupId, setProdWaGroupId] = useState<string>("");
  const [prodWaSearch, setProdWaSearch] = useState("");
  const [prodWaPickerOpen, setProdWaPickerOpen] = useState(false);

  const [weeklyWaGroupId, setWeeklyWaGroupId] = useState<string>("");
  const [weeklyWaSearch, setWeeklyWaSearch] = useState("");
  const [weeklyWaPickerOpen, setWeeklyWaPickerOpen] = useState(false);

  const [codePrefix, setCodePrefix] = useState("HMD13");
  const [findStr, setFindStr] = useState("-");
  const [replaceStr, setReplaceStr] = useState(" ");
  const [renamePreview, setRenamePreview] = useState<RenamePreviewItem[] | null>(null);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelResult, setExcelResult] = useState<{ created: number; updated: number; categoriesCreated: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [baleImportFile, setBaleImportFile] = useState<File | null>(null);
  const [baleImportResult, setBaleImportResult] = useState<{ totalBalesCreated: number; skippedRows: number; skippedDetails: string[] } | null>(null);
  const baleFileInputRef = useRef<HTMLInputElement>(null);
  const [baleImportLocationId, setBaleImportLocationId] = useState<string>("");
  const [baleValidationResult, setBaleValidationResult] = useState<{
    totalRows: number;
    validRows: { rowIndex: number; articleCode: string; productName: string; productId: number; quantity: number; weight: number; productionDate: string }[];
    skippedRows: { rowIndex: number; articleCode: string; reason: string }[];
    totalBales: number;
    totalWeight: number;
    totalProducts: number;
  } | null>(null);

  type OcContainer = { containerId: number; containerNumber: string; charges: { id: number; description: string; amount: string; currencyCode: string }[] };
  const [ocPreview, setOcPreview] = useState<OcContainer[] | null>(null);
  const [ocFixResult, setOcFixResult] = useState<{ fixed: number } | null>(null);

  const ocPreviewMutation = useMutation({
    mutationFn: async () => {
      const res = await factoryApiRequest("GET", "/api/factory/admin/other-charges-currency-preview");
      if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Failed"); }
      return res.json() as Promise<{ containers: OcContainer[] }>;
    },
    onSuccess: (data) => {
      setOcPreview(data.containers);
      setOcFixResult(null);
      if (data.containers.length === 0) {
        toast({ title: "All clear", description: "No other charges found with non-USD currency." });
      }
    },
    onError: (err: Error) => { if (err?._handledGlobally) return; toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const ocFixMutation = useMutation({
    mutationFn: async (containerIds: number[]) => {
      const res = await factoryApiRequest("POST", "/api/factory/admin/fix-other-charges-currency", { containerIds });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Failed"); }
      return res.json() as Promise<{ fixed: number }>;
    },
    onSuccess: (data) => {
      setOcFixResult(data);
      setOcPreview(null);
      toast({ title: "Fixed", description: `${data.fixed} container(s) re-posted in USD.` });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/net-profit-statement"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/net-profit"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
    },
    onError: (err: Error) => { if (err?._handledGlobally) return; toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await factoryApiRequest("POST", "/api/factory/bale-products/bulk-rename-preview", {
        codePrefix,
        find: findStr,
        replace: replaceStr,
      });
      return res.json();
    },
    onSuccess: (data: { total: number; matches: RenamePreviewItem[] }) => {
      setRenamePreview(data.matches);
      if (data.matches.length === 0) {
        toast({ title: "No matches", description: `Found ${data.total} products with code prefix "${codePrefix}" but none have "${findStr}" in their name.` });
      }
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async (items: RenamePreviewItem[]) => {
      const res = await factoryApiRequest("POST", "/api/factory/bale-products/bulk-rename-apply", { items });
      return res.json();
    },
    onSuccess: (data: { updated: number }) => {
      toast({ title: "Renamed successfully", description: `${data.updated} product name(s) updated.` });
      setRenamePreview(null);
      queryClient.invalidateQueries({ queryKey: ['/api/factory/bale-products'] });
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const excelUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/factory/bale-products/import-excel", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: (data: { created: number; updated: number; categoriesCreated: number }) => {
      setExcelResult(data);
      setExcelFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });
      toast({
        title: "Excel import complete",
        description: `${data.updated} updated, ${data.created} created${data.categoriesCreated > 0 ? `, ${data.categoriesCreated} categories created` : ""}`,
      });
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Import error", description: error.message, variant: "destructive" });
    },
  });

  const baleValidateMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/factory/bales/validate-import", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Validation failed");
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      setBaleValidationResult(data);
      setBaleImportResult(null);
      if (data.validRows.length === 0) {
        toast({ title: "No valid rows", description: `All ${data.totalRows} rows were skipped. Check the details below.`, variant: "destructive" });
      } else {
        toast({ title: "Validation complete", description: `${data.validRows.length} row(s) ready to import (${data.totalBales} bales, ${data.totalWeight.toFixed(1)} kg)` });
      }
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Validation error", description: error.message, variant: "destructive" });
    },
  });

  const baleImportMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      if (baleImportLocationId) formData.append("locationId", baleImportLocationId);
      const res = await fetch("/api/factory/bales/import-excel", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: (data: { totalBalesCreated: number; skippedRows: number; skippedDetails: string[] }) => {
      setBaleImportResult(data);
      setBaleValidationResult(null);
      setBaleImportFile(null);
      if (baleFileInputRef.current) baleFileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      toast({
        title: "Bale import complete",
        description: `${data.totalBalesCreated} bale(s) created${data.skippedRows > 0 ? `, ${data.skippedRows} row(s) skipped` : ""}`,
      });
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Import error", description: error.message, variant: "destructive" });
    },
  });

  const { data: locations } = useQuery<Location[]>({ queryKey: ["/api/locations"] });

  const { data, isLoading } = useQuery<FactorySettingsData>({
    queryKey: ['/api/factory/settings'],
  });

  useEffect(() => {
    if (data) {
      setSettings({ ...defaultSettings, ...data });
      setProdWaGroupId((data as any).productionWorkerMatrixWhatsappGroupId ?? "");
    }
  }, [data]);

  const { data: waChats = [], isLoading: waChatsLoading } = useQuery<WaChat[]>({
    queryKey: ["/api/whatsapp/chats/pos"],
    queryFn: async () => {
      const r = await factoryApiRequest("GET", "/api/whatsapp/chats/pos");
      if (!r.ok) throw new Error("Failed to load chats");
      return r.json();
    },
    enabled: prodWaPickerOpen,
    staleTime: 60_000,
    retry: false,
  });

  const { data: weeklyWaChats = [], isLoading: weeklyWaChatsLoading } = useQuery<WaChat[]>({
    queryKey: ["/api/whatsapp/chats"],
    queryFn: async () => {
      const r = await factoryApiRequest("GET", "/api/whatsapp/chats");
      if (!r.ok) throw new Error("Failed to load chats");
      return r.json();
    },
    enabled: weeklyWaPickerOpen,
    staleTime: 60_000,
    retry: false,
  });

  const { data: weeklyWaSettings } = useQuery<{ groupChatId: string; hasCredentials: boolean }>({
    queryKey: ["/api/factory/weekly-report-wa-settings"],
  });

  useEffect(() => {
    if (weeklyWaSettings?.groupChatId) setWeeklyWaGroupId(weeklyWaSettings.groupChatId);
  }, [weeklyWaSettings]);

  const saveWeeklyWaGroupMutation = useMutation({
    mutationFn: async (chatId: string) => {
      const res = await factoryApiRequest("PATCH", "/api/factory/weekly-report-wa-settings", { groupChatId: chatId });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Save failed"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/weekly-report-wa-settings"] });
      setWeeklyWaPickerOpen(false);
      toast({ title: "Saved", description: "Weekly report WhatsApp group updated." });
    },
    onError: (err: any) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const filteredWeeklyWaChats = weeklyWaChats.filter(
    (c) => !weeklyWaSearch || c.name?.toLowerCase().includes(weeklyWaSearch.toLowerCase())
  );

  const saveProdWaGroupMutation = useMutation({
    mutationFn: async (chatId: string) => {
      const res = await factoryApiRequest("PUT", "/api/factory/settings", {
        productionWorkerMatrixWhatsappGroupId: chatId,
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Save failed"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/settings"] });
      setProdWaPickerOpen(false);
      toast({ title: "Saved", description: "Production WhatsApp group updated." });
    },
    onError: (err: any) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const filteredWaChats = waChats.filter(c =>
    !prodWaSearch || c.name?.toLowerCase().includes(prodWaSearch.toLowerCase())
  );

  const mutation = useMutation({
    mutationFn: async (updated: FactorySettingsData) => {
      const res = await factoryApiRequest("PUT", "/api/factory/settings", updated);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/factory/settings'] });
      toast({ title: "Settings saved", description: "Factory settings have been updated successfully." });
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleToggle = (key: keyof FactorySettingsData) => {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleNumberChange = (key: keyof FactorySettingsData, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: parseFloat(value) || 0 }));
  };

  const handleSave = () => {
    mutation.mutate(settings);
  };

  const handleEnableAll = () => {
    const allEnabled: FactorySettingsData = {
      ...settings,
      dashboardEnabled: true,
      kpisEnabled: true,
      profitabilityEnabled: true,
      alertsEnabled: true,
      supplierScoringEnabled: true,
      mixOptimizerEnabled: true,
      traceabilityEnabled: true,
      balePhotosEnabled: true,
      wasteTrackingEnabled: true,
      cashflowEnabled: true,
      rolesEnabled: true,
      netProfitEnabled: true,
      productionSummaryEnabled: true,
      supplierReportEnabled: true,
      supplierStatementEnabled: true,
      daybookEnabled: true,
      workersTabPayrollEnabled: true,
      workersTabAttendanceEnabled: true,
      workersTabReportEnabled: true,
      workersTabAdvancesEnabled: true,
      workersTabBonusesEnabled: true,
      balesTabBarcodeEnabled: true,
      balesTabRemoveEnabled: true,
      loadingsTabPendingEnabled: true,
      stockEntryTabEntryEnabled: true,
      stockEntryTabHistoryEnabled: true,
      advancesTabRepaymentsEnabled: true,
      kpisTabWorkerPerformanceEnabled: true,
      kpisTabMixEfficiencyEnabled: true,
      payrollTabWorkerMasterEnabled: true,
      profitabilityTabContainersEnabled: true,
      workersTabCategoriesEnabled: true,
      workerDetailTabStatementEnabled: true,
      workerDetailTabAdvancesEnabled: true,
      workerDetailTabBalesEnabled: true,
      workerDetailTabDocumentsEnabled: true,
    };
    setSettings(allEnabled);
    mutation.mutate(allEnabled);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading factory settings...</span>
      </div>
    );
  }

  const toggleItem = (label: string, key: keyof FactorySettingsData) => (
    <div className="flex items-center justify-between gap-4 py-3" key={key} data-testid={`toggle-row-${key}`}>
      <Label htmlFor={key} className="text-sm font-medium cursor-pointer">{label}</Label>
      <Switch
        id={key}
        checked={!!settings[key]}
        onCheckedChange={() => handleToggle(key)}
        data-testid={`switch-${key}`}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <PageHeader title="Factory Settings" subtitle="Toggle factory intelligence features on or off" />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleEnableAll} disabled={mutation.isPending} data-testid="button-enable-all">
            <ToggleRight className="h-4 w-4 mr-2" />
            Enable All
          </Button>
          <Button onClick={handleSave} disabled={mutation.isPending} data-testid="button-save-settings">
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save Settings
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle data-testid="text-section-production">Production Intelligence</CardTitle>
            <CardDescription>Core production monitoring and analytics</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {toggleItem("Dashboard", "dashboardEnabled")}
            {toggleItem("KPIs", "kpisEnabled")}
            {toggleItem("Waste Tracking", "wasteTrackingEnabled")}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle data-testid="text-section-financial">Financial Intelligence</CardTitle>
            <CardDescription>Profitability and cash flow analysis</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {toggleItem("Profitability Engine", "profitabilityEnabled")}
            {toggleItem("Cash Flow", "cashflowEnabled")}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle data-testid="text-section-supply-chain">Supply Chain</CardTitle>
            <CardDescription>Supplier management, optimization, and traceability</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {toggleItem("Supplier Scoring", "supplierScoringEnabled")}
            {toggleItem("Mix Optimizer", "mixOptimizerEnabled")}
            {toggleItem("Traceability", "traceabilityEnabled")}
            {toggleItem("Bale Photos", "balePhotosEnabled")}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle data-testid="text-section-operations">Operations</CardTitle>
            <CardDescription>Alerts and access control</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {toggleItem("Alerts System", "alertsEnabled")}
            {toggleItem("Roles & Permissions", "rolesEnabled")}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle data-testid="text-section-reports">Reports</CardTitle>
            <CardDescription>Toggle report pages on or off for all users</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {toggleItem("Net Profit", "netProfitEnabled")}
            {toggleItem("Production Summary", "productionSummaryEnabled")}
            {toggleItem("Supplier Report", "supplierReportEnabled")}
            {toggleItem("Supplier Statement", "supplierStatementEnabled")}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle data-testid="text-section-pages">Page Visibility</CardTitle>
            <CardDescription>Show or hide entire pages for all users</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {toggleItem("Daybook", "daybookEnabled")}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle data-testid="text-section-tabs">Page Tabs</CardTitle>
            <CardDescription>Disable tabs you don't use — they will be hidden from all users</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            <p className="text-xs text-muted-foreground pt-3 pb-1 font-medium uppercase tracking-wide">Workers Hub</p>
            {toggleItem("Payroll tab", "workersTabPayrollEnabled")}
            {toggleItem("Attendance tab", "workersTabAttendanceEnabled")}
            {toggleItem("Report tab", "workersTabReportEnabled")}
            {toggleItem("Advances tab", "workersTabAdvancesEnabled")}
            {toggleItem("Bonuses tab", "workersTabBonusesEnabled")}
            <p className="text-xs text-muted-foreground pt-3 pb-1 font-medium uppercase tracking-wide">Bales Hub</p>
            {toggleItem("Barcode Lookup tab", "balesTabBarcodeEnabled")}
            {toggleItem("Remove from Stock tab", "balesTabRemoveEnabled")}
            <p className="text-xs text-muted-foreground pt-3 pb-1 font-medium uppercase tracking-wide">Loadings Hub</p>
            {toggleItem("Pending Loadings tab", "loadingsTabPendingEnabled")}
            <p className="text-xs text-muted-foreground pt-3 pb-1 font-medium uppercase tracking-wide">Stock Entry</p>
            {toggleItem("Stock Entry tab", "stockEntryTabEntryEnabled")}
            {toggleItem("Stock Entry History tab", "stockEntryTabHistoryEnabled")}
            <p className="text-xs text-muted-foreground pt-3 pb-1 font-medium uppercase tracking-wide">Advances</p>
            {toggleItem("Repayments tab", "advancesTabRepaymentsEnabled")}
            <p className="text-xs text-muted-foreground pt-3 pb-1 font-medium uppercase tracking-wide">KPIs</p>
            {toggleItem("Worker Performance tab", "kpisTabWorkerPerformanceEnabled")}
            {toggleItem("Mix Efficiency tab", "kpisTabMixEfficiencyEnabled")}
            <p className="text-xs text-muted-foreground pt-3 pb-1 font-medium uppercase tracking-wide">Payroll</p>
            {toggleItem("Worker Master tab", "payrollTabWorkerMasterEnabled")}
            <p className="text-xs text-muted-foreground pt-3 pb-1 font-medium uppercase tracking-wide">Profitability</p>
            {toggleItem("Container Profitability tab", "profitabilityTabContainersEnabled")}
            <p className="text-xs text-muted-foreground pt-3 pb-1 font-medium uppercase tracking-wide">Workers List</p>
            {toggleItem("Categories tab", "workersTabCategoriesEnabled")}
            <p className="text-xs text-muted-foreground pt-3 pb-1 font-medium uppercase tracking-wide">Worker Profile</p>
            {toggleItem("Statement tab", "workerDetailTabStatementEnabled")}
            {toggleItem("Advances tab", "workerDetailTabAdvancesEnabled")}
            {toggleItem("Bales tab", "workerDetailTabBalesEnabled")}
            {toggleItem("Documents tab", "workerDetailTabDocumentsEnabled")}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle data-testid="text-section-display">Display Options</CardTitle>
            <CardDescription>Control what prices and values are visible to users</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {toggleItem("Hide Selling Price", "hideSellingPrice")}
            {toggleItem("Hide Avg Cost", "hideAvgCost")}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle data-testid="text-section-cost">Cost Configuration</CardTitle>
            <CardDescription>Default cost parameters for profitability calculations</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="laborCostPerKg">Labor Cost per KG</Label>
                <Input
                  id="laborCostPerKg"
                  type="number"
                  step="0.01"
                  min="0"
                  value={settings.laborCostPerKg}
                  onChange={(e) => handleNumberChange("laborCostPerKg", e.target.value)}
                  data-testid="input-laborCostPerKg"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="overheadPerKg">Overhead per KG</Label>
                <Input
                  id="overheadPerKg"
                  type="number"
                  step="0.01"
                  min="0"
                  value={settings.overheadPerKg}
                  onChange={(e) => handleNumberChange("overheadPerKg", e.target.value)}
                  data-testid="input-overheadPerKg"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="md:col-span-2">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-muted-foreground" />
            <CardTitle data-testid="text-section-data-cleanup">Data Cleanup</CardTitle>
          </div>
          <CardDescription>Find products by code prefix and rename them in bulk</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="codePrefix">Code Prefix</Label>
              <Input
                id="codePrefix"
                value={codePrefix}
                onChange={(e) => { setCodePrefix(e.target.value); setRenamePreview(null); }}
                placeholder="e.g. HMD13"
                data-testid="input-code-prefix"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="findStr">Find in Name</Label>
              <Input
                id="findStr"
                value={findStr}
                onChange={(e) => { setFindStr(e.target.value); setRenamePreview(null); }}
                placeholder="e.g. -"
                data-testid="input-find-str"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="replaceStr">Replace With</Label>
              <Input
                id="replaceStr"
                value={replaceStr}
                onChange={(e) => { setReplaceStr(e.target.value); setRenamePreview(null); }}
                placeholder="e.g. (space)"
                data-testid="input-replace-str"
              />
            </div>
          </div>
          <Button
            onClick={() => previewMutation.mutate()}
            disabled={previewMutation.isPending || !codePrefix.trim() || !findStr}
            data-testid="button-preview-rename"
          >
            {previewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
            Preview Changes
          </Button>

          {renamePreview && renamePreview.length > 0 && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                {renamePreview.length} product(s) will be renamed:
              </div>
              <div className="max-h-80 overflow-y-auto border rounded-md">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Current Name</TableHead>
                      <TableHead className="w-8"></TableHead>
                      <TableHead>New Name</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {renamePreview.map((item) => (
                      <TableRow key={item.id} data-testid={`row-rename-${item.id}`}>
                        <TableCell className="font-mono text-xs">{item.code}</TableCell>
                        <TableCell>{item.currentName}</TableCell>
                        <TableCell><ArrowRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                        <TableCell className="font-medium">{item.newName}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button
                onClick={() => applyMutation.mutate(renamePreview)}
                disabled={applyMutation.isPending}
                data-testid="button-apply-rename"
              >
                {applyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                Apply {renamePreview.length} Rename(s)
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-muted-foreground" />
            <CardTitle data-testid="text-section-excel-import">Excel Product Import</CardTitle>
          </div>
          <CardDescription>Upload an Excel file to update bale product names, weights, and categories by matching on article code</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground space-y-1">
            <p>Your Excel file should have these column headers:</p>
            <ul className="list-disc list-inside ml-2 space-y-0.5">
              <li><span className="font-mono text-xs">articleCode</span> (required) - matches existing products</li>
              <li><span className="font-mono text-xs">name</span> - new product name</li>
              <li><span className="font-mono text-xs">weightPerBaleKg</span> - weight per bale in KG</li>
              <li><span className="font-mono text-xs">category</span> - product category (auto-created if new)</li>
              <li><span className="font-mono text-xs">description</span> - product description (optional)</li>
            </ul>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                setExcelFile(e.target.files?.[0] || null);
                setExcelResult(null);
              }}
              className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
              data-testid="input-excel-file"
            />
            <Button
              onClick={() => excelFile && excelUploadMutation.mutate(excelFile)}
              disabled={!excelFile || excelUploadMutation.isPending}
              data-testid="button-upload-excel"
            >
              {excelUploadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
              {excelUploadMutation.isPending ? "Importing..." : "Import"}
            </Button>
          </div>
          {excelResult && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-muted text-sm" data-testid="text-excel-result">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span>{excelResult.updated} product(s) updated, {excelResult.created} new product(s) created{excelResult.categoriesCreated > 0 ? `, ${excelResult.categoriesCreated} new category(ies)` : ""}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-muted-foreground" />
            <CardTitle data-testid="text-section-bale-import">Import Historical Bales</CardTitle>
          </div>
          <CardDescription>Upload an Excel file to import old stock as bales. Each row creates bales with automatic REF codes and the specified production date.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground space-y-1">
            <p>Your Excel file should have these column headers:</p>
            <ul className="list-disc list-inside ml-2 space-y-0.5">
              <li><span className="font-mono text-xs">ITEM BARCODE</span> (required) - article code to match existing products (e.g. HMD11298)</li>
              <li><span className="font-mono text-xs">QUANTITY</span> - number of bales to create (default: 1)</li>
              <li><span className="font-mono text-xs">PRODUCTION DATE</span> - date the bales were produced (required)</li>
            </ul>
            <p className="mt-2 text-xs">Products must already exist in the system. The weight will be taken from the product definition.</p>
          </div>
          <div className="space-y-2">
            <Label>Location / Warehouse</Label>
            <Select value={baleImportLocationId} onValueChange={setBaleImportLocationId}>
              <SelectTrigger className="w-64" data-testid="select-bale-import-location">
                <SelectValue placeholder="Select location..." />
              </SelectTrigger>
              <SelectContent>
                {locations?.map((loc) => (
                  <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              variant="outline"
              onClick={() => {
                const header = "ITEM BARCODE\tQUANTITY\tPRODUCTION DATE\n";
                const example = "HMD11298\t1\t2/11/2026\n";
                const blob = new Blob([header + example], { type: "application/vnd.ms-excel" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "bale_import_template.xls";
                a.click();
                URL.revokeObjectURL(url);
              }}
              data-testid="button-download-bale-template"
            >
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              ref={baleFileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                setBaleImportFile(e.target.files?.[0] || null);
                setBaleImportResult(null);
                setBaleValidationResult(null);
              }}
              className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
              data-testid="input-bale-import-file"
            />
            <Button
              onClick={() => baleImportFile && baleValidateMutation.mutate(baleImportFile)}
              disabled={!baleImportFile || baleValidateMutation.isPending}
              data-testid="button-validate-bales"
            >
              {baleValidateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
              {baleValidateMutation.isPending ? "Validating..." : "Validate"}
            </Button>
          </div>

          {baleValidationResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-4 flex-wrap p-3 rounded-md bg-muted text-sm">
                <span>Total rows: <strong>{baleValidationResult.totalRows}</strong></span>
                <span>Valid: <strong className="text-green-600">{baleValidationResult.validRows.length}</strong></span>
                <span>Skipped: <strong className={baleValidationResult.skippedRows.length > 0 ? "text-destructive" : ""}>{baleValidationResult.skippedRows.length}</strong></span>
                <span>Bales to create: <strong>{baleValidationResult.totalBales}</strong></span>
                <span>Total weight: <strong>{baleValidationResult.totalWeight.toFixed(1)} kg</strong></span>
              </div>

              {baleValidationResult.validRows.length > 0 && (
                <div className="border rounded-md overflow-auto max-h-64">
                  <Table>
                    <TableHeader className="sticky top-0 z-30 bg-background">
                      <TableRow>
                        <TableHead className="w-12">Row</TableHead>
                        <TableHead>Article Code</TableHead>
                        <TableHead>Product Name</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Weight (kg)</TableHead>
                        <TableHead>Production Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {baleValidationResult.validRows.map((row, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-muted-foreground text-xs">{row.rowIndex}</TableCell>
                          <TableCell className="font-mono text-xs">{row.articleCode}</TableCell>
                          <TableCell>{row.productName}</TableCell>
                          <TableCell className="text-right">{row.quantity}</TableCell>
                          <TableCell className="text-right">{row.weight}</TableCell>
                          <TableCell>{row.productionDate}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {baleValidationResult.skippedRows.length > 0 && (
                <div className="text-xs p-3 rounded-md border border-destructive/30 space-y-1">
                  <p className="font-medium text-destructive text-sm">Skipped rows:</p>
                  {baleValidationResult.skippedRows.map((row, i) => (
                    <p key={i} className="text-muted-foreground">
                      Row {row.rowIndex}: {row.articleCode ? `"${row.articleCode}"` : "(empty)"} - {row.reason}
                    </p>
                  ))}
                </div>
              )}

              {baleValidationResult.validRows.length > 0 && (
                <div className="flex items-center gap-3 flex-wrap pt-2">
                  <Button
                    onClick={() => baleImportFile && baleImportMutation.mutate(baleImportFile)}
                    disabled={!baleImportFile || baleImportMutation.isPending || !baleImportLocationId}
                    data-testid="button-finalize-import-bales"
                  >
                    {baleImportMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                    {baleImportMutation.isPending ? "Importing..." : `Finalize Import (${baleValidationResult.totalBales} bales)`}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setBaleValidationResult(null);
                      setBaleImportFile(null);
                      if (baleFileInputRef.current) baleFileInputRef.current.value = "";
                    }}
                    data-testid="button-cancel-import"
                  >
                    Cancel
                  </Button>
                  {!baleImportLocationId && (
                    <span className="text-xs text-destructive">Please select a location above before finalizing</span>
                  )}
                </div>
              )}
            </div>
          )}

          {baleImportResult && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-3 rounded-md bg-muted text-sm" data-testid="text-bale-import-result">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span>{baleImportResult.totalBalesCreated} bale(s) created with automatic REF codes{baleImportResult.skippedRows > 0 ? ` | ${baleImportResult.skippedRows} row(s) skipped` : ""}</span>
              </div>
              {baleImportResult.skippedDetails.length > 0 && (
                <div className="text-xs text-muted-foreground p-2 rounded-md border space-y-0.5">
                  <p className="font-medium">Skipped rows:</p>
                  {baleImportResult.skippedDetails.map((detail, i) => (
                    <p key={i}>{detail}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Fix Other Charges Currency ───────────────────────── */}
      {isDeveloper && <Card data-testid="card-fix-oc-currency">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-muted-foreground" />
            Fix Other Charges Currency
          </CardTitle>
          <CardDescription>
            If other charges were accidentally entered in EUR instead of USD, this tool
            re-posts their accounting entries in USD without reversing the offload.
            Click "Preview" first to see which containers are affected, then "Apply Fix".
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={() => ocPreviewMutation.mutate()}
              disabled={ocPreviewMutation.isPending || ocFixMutation.isPending}
              data-testid="button-oc-currency-preview"
            >
              {ocPreviewMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
              Preview
            </Button>
            {ocPreview && ocPreview.length > 0 && (
              <Button
                onClick={() => ocFixMutation.mutate(ocPreview.map(c => c.containerId))}
                disabled={ocFixMutation.isPending}
                data-testid="button-oc-currency-apply"
              >
                {ocFixMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <DollarSign className="h-4 w-4 mr-2" />}
                Apply Fix — Re-post as USD ({ocPreview.length} container{ocPreview.length !== 1 ? "s" : ""})
              </Button>
            )}
          </div>

          {ocPreview && ocPreview.length > 0 && (
            <div className="space-y-2" data-testid="section-oc-preview">
              <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400 p-2 bg-amber-50 dark:bg-amber-950/30 rounded-md">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  Found <strong>{ocPreview.length}</strong> container{ocPreview.length !== 1 ? "s" : ""} with non-USD other charges.
                  The existing EUR vouchers will be deleted and replaced with USD ones. The offload data is not affected.
                </span>
              </div>
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead>Container</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-center">Current Currency</TableHead>
                      <TableHead className="text-center">Will Become</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ocPreview.flatMap(container =>
                      container.charges.map((charge, chargeIdx) => (
                        <TableRow key={`${container.containerId}-${chargeIdx}`} data-testid={`row-oc-preview-${container.containerId}-${chargeIdx}`}>
                          {chargeIdx === 0 && (
                            <TableCell rowSpan={container.charges.length} className="font-medium align-top">
                              {container.containerNumber}
                            </TableCell>
                          )}
                          <TableCell className="text-muted-foreground">{charge.description}</TableCell>
                          <TableCell className="text-right font-mono">
                            {parseFloat(charge.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                              {charge.currencyCode}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                              USD
                            </span>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {ocFixResult && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-muted text-sm" data-testid="text-oc-fix-result">
              <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
              <span>
                Done — {ocFixResult.fixed} container{ocFixResult.fixed !== 1 ? "s" : ""} re-posted in USD.
                The accounting ledger now shows USD for those other charges.
              </span>
            </div>
          )}
        </CardContent>
      </Card>}

      {/* ── Import Bales ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
            Import Bales
          </CardTitle>
          <CardDescription>
            Bulk import bales from an Excel spreadsheet template.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <ImportBalesTab />
        </CardContent>
      </Card>

      {/* ── Label Banner Images ──────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Images className="h-5 w-5 text-muted-foreground" />
            Label Banner Images
          </CardTitle>
          <CardDescription>
            Replace the colored HMD header banners printed on A4 bale labels. Upload your own image for each of the 5 design colors (purple, green, gold, white, red).
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Button
            variant="outline"
            onClick={() => window.location.href = "/factory/label-banners"}
            data-testid="button-open-label-banners"
          >
            <Images className="h-4 w-4 mr-2" />
            Manage Label Banners
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </CardContent>
      </Card>

      {/* ── Product Images ───────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Images className="h-5 w-5 text-muted-foreground" />
            Product Images
          </CardTitle>
          <CardDescription>
            Upload and manage product images for each article code. Images can be attached to any bale product and used for catalogues, labels, or reference.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Button
            variant="outline"
            onClick={() => window.location.href = "/factory/bale-product-images"}
            data-testid="button-open-product-images"
          >
            <Images className="h-4 w-4 mr-2" />
            Manage Product Images
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </CardContent>
      </Card>

      {/* ── Production WhatsApp Group ─────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-muted-foreground" />
            Production WhatsApp Group
          </CardTitle>
          <CardDescription>
            Select the WhatsApp group that receives the Worker Matrix PDF when production is ended. This group is also used for manual sends from Stock Entry History.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {prodWaGroupId && !prodWaPickerOpen && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium" data-testid="text-prod-wa-group">
                {waChats.find(c => c.id === prodWaGroupId)?.name ?? prodWaGroupId}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setProdWaPickerOpen(true)}
                data-testid="button-change-prod-wa-group"
              >
                Change
              </Button>
            </div>
          )}
          {!prodWaGroupId && !prodWaPickerOpen && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setProdWaPickerOpen(true)}
              data-testid="button-select-prod-wa-group"
            >
              <MessageCircle className="h-4 w-4 mr-2" />
              Select WhatsApp Group
            </Button>
          )}
          {prodWaPickerOpen && (
            <div className="space-y-2">
              <Input
                placeholder="Search chats…"
                value={prodWaSearch}
                onChange={e => setProdWaSearch(e.target.value)}
                data-testid="input-prod-wa-search"
              />
              <div className="border rounded-md max-h-48 overflow-y-auto text-sm">
                {waChatsLoading && (
                  <p className="text-muted-foreground text-center py-4">
                    <Loader2 className="h-4 w-4 inline mr-1 animate-spin" />Loading chats…
                  </p>
                )}
                {!waChatsLoading && filteredWaChats.length === 0 && (
                  <p className="text-muted-foreground text-center py-4">No chats found</p>
                )}
                {filteredWaChats.map(chat => (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => setProdWaGroupId(chat.id)}
                    className={`w-full text-left px-3 py-2 hover-elevate transition-colors ${
                      prodWaGroupId === chat.id ? "bg-primary/10 text-primary font-medium" : ""
                    }`}
                    data-testid={`option-prod-wa-chat-${chat.id}`}
                  >
                    <div className="font-medium">{chat.name}</div>
                    <div className="text-xs text-muted-foreground">{chat.type}</div>
                  </button>
                ))}
              </div>
              {prodWaGroupId && (
                <p className="text-xs text-muted-foreground">
                  Selected: <span className="font-medium">{
                    waChats.find(c => c.id === prodWaGroupId)?.name ?? prodWaGroupId
                  }</span>
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => saveProdWaGroupMutation.mutate(prodWaGroupId)}
                  disabled={!prodWaGroupId || saveProdWaGroupMutation.isPending}
                  data-testid="button-save-prod-wa-group"
                >
                  {saveProdWaGroupMutation.isPending
                    ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    : <CheckCircle className="h-3 w-3 mr-1" />}
                  Save
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setProdWaPickerOpen(false); setProdWaSearch(""); }}
                  data-testid="button-cancel-prod-wa-group"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Weekly Report WhatsApp Group ──────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-muted-foreground" />
            Weekly Report WhatsApp Group
          </CardTitle>
          <CardDescription>
            Select the WhatsApp group that receives the Weekly Production Report Excel file when you press "Send" on the report panel.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {weeklyWaGroupId && !weeklyWaPickerOpen && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium" data-testid="text-weekly-wa-group">
                {weeklyWaChats.find(c => c.id === weeklyWaGroupId)?.name ?? weeklyWaGroupId}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWeeklyWaPickerOpen(true)}
                data-testid="button-change-weekly-wa-group"
              >
                Change
              </Button>
            </div>
          )}
          {!weeklyWaGroupId && !weeklyWaPickerOpen && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setWeeklyWaPickerOpen(true)}
              data-testid="button-select-weekly-wa-group"
            >
              <MessageCircle className="h-4 w-4 mr-2" />
              Select WhatsApp Group
            </Button>
          )}
          {weeklyWaPickerOpen && (
            <div className="space-y-2">
              <Input
                placeholder="Search chats…"
                value={weeklyWaSearch}
                onChange={e => setWeeklyWaSearch(e.target.value)}
                data-testid="input-weekly-wa-search"
              />
              <div className="border rounded-md max-h-48 overflow-y-auto text-sm">
                {weeklyWaChatsLoading && (
                  <p className="text-muted-foreground text-center py-4">
                    <Loader2 className="h-4 w-4 inline mr-1 animate-spin" />Loading chats…
                  </p>
                )}
                {!weeklyWaChatsLoading && filteredWeeklyWaChats.length === 0 && (
                  <p className="text-muted-foreground text-center py-4">No chats found</p>
                )}
                {filteredWeeklyWaChats.map(chat => (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => setWeeklyWaGroupId(chat.id)}
                    className={`w-full text-left px-3 py-2 hover-elevate transition-colors ${
                      weeklyWaGroupId === chat.id ? "bg-primary/10 text-primary font-medium" : ""
                    }`}
                    data-testid={`option-weekly-wa-chat-${chat.id}`}
                  >
                    <div className="font-medium">{chat.name}</div>
                    <div className="text-xs text-muted-foreground">{chat.type}</div>
                  </button>
                ))}
              </div>
              {weeklyWaGroupId && (
                <p className="text-xs text-muted-foreground">
                  Selected: <span className="font-medium">{
                    weeklyWaChats.find(c => c.id === weeklyWaGroupId)?.name ?? weeklyWaGroupId
                  }</span>
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => saveWeeklyWaGroupMutation.mutate(weeklyWaGroupId)}
                  disabled={!weeklyWaGroupId || saveWeeklyWaGroupMutation.isPending}
                  data-testid="button-save-weekly-wa-group"
                >
                  {saveWeeklyWaGroupMutation.isPending
                    ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    : <CheckCircle className="h-3 w-3 mr-1" />}
                  Save
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setWeeklyWaPickerOpen(false); setWeeklyWaSearch(""); }}
                  data-testid="button-cancel-weekly-wa-group"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Offline Mode ────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <WifiOff className="h-5 w-5 text-muted-foreground" />
            Offline Mode
          </CardTitle>
          <CardDescription>
            Download all factory data to this device so it works without internet. Mutations
            made while offline are queued and auto-synced when the connection returns.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OfflinePrepPanel />
        </CardContent>
      </Card>

      {/* ── Data Maintenance ─────────────────────────────────── */}
      <RecalculateBaleCostsCard />
      <MigrateVoucherDescriptionsCard />
    </div>
  );
}
