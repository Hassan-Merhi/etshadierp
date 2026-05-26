  import { useState, useEffect, useRef } from "react";
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
import { StockItemAutocomplete } from "@/components/StockItemAutocomplete";
  import { useMutation, useQuery } from "@tanstack/react-query";
  import { queryClient, apiRequest } from "@/lib/queryClient";
  import { useAppMode } from "@/contexts/AppModeContext";
  import { getApiRequest, factoryApiRequest } from "@/lib/factoryApi";
  import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
  import { Plus, Edit, Building2, Users, ChevronDown, ChevronUp, Trash2, CalendarRange, Settings2, Wrench, MapPin, ChevronRight, Bot, MessageCircle, RefreshCw, Calculator, Loader2, Shield, AlertTriangle, PieChart, Key, Lock, Package, Eye, History, Clock, Upload, Download, Database, TrendingUp, TrendingDown, ShoppingCart, Check, X, Copy, ExternalLink, ArrowLeftRight, WifiOff, Wifi, CheckCircle2, Printer, Layers, FileSpreadsheet, FileDown, RotateCcw } from "lucide-react";
import { utils, writeFile, readFile, read, ExcelJS } from "@/lib/excelHelper";
  import { Link } from "wouter";
  import { useDateFormat } from "@/contexts/DateFormatContext";
  import { insertUserSchema, insertCompanySchema, insertUserCompanyRoleSchema, FEATURE_KEYS, FEATURE_PAGE_INFO, type FeatureKey } from "@shared/schema";
  import { FACTORY_NAV_PAGES } from "@/components/FactorySidebar";
  import { FiscalPeriodTab } from "@/components/FiscalPeriodTab";
  import { useCompany } from "@/contexts/CompanyContext";
  import { ExchangeRateSettings } from "@/components/ExchangeRateSettings";
  import { formatNumber } from "@/lib/formatNumber";
  
interface SilentImportRow {
  rawCode: string;
  rawName: string;
  stockItemId: number | null;
  stockItemName: string;
  currentQty: number;
  change: number;
  newQty: number;
  rate: number;
  status: 'ok' | 'not_found' | 'to_zero';
}

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


export function DataToolsTab() {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  
  // Separate location selection for each import operation
  const [costPriceLocationId, setCostPriceLocationId] = useState<string>("");
  const [stockLocationId, setStockLocationId] = useState<string>("");
  
  // Cost price import state
  const [costPriceImportOpen, setCostPriceImportOpen] = useState(false);
  const [costPriceFile, setCostPriceFile] = useState<File | null>(null);
  const [costPricePreview, setCostPricePreview] = useState<Array<{ barcode: string; costPrice: number }>>([]);
  const [costPriceErrors, setCostPriceErrors] = useState<string[]>([]);
  const [isImportingCostPrice, setIsImportingCostPrice] = useState(false);
  const [costPriceImportComplete, setCostPriceImportComplete] = useState(false);

  // Stock import state
  const [stockImportOpen, setStockImportOpen] = useState(false);
  const [stockFile, setStockFile] = useState<File | null>(null);
  const [stockPreview, setStockPreview] = useState<Array<{ Item_barcode: string; stockGroupCode?: string; quantity: string; rate: string; value: string }>>([]);
  const [stockErrors, setStockErrors] = useState<string[]>([]);
  const [isImportingStock, setIsImportingStock] = useState(false);
  const [stockImportComplete, setStockImportComplete] = useState(false);

  // Current user (for developer-only features)
  const { data: dtCurrentUser } = useQuery<{ role?: string }>({ queryKey: ["/api/auth/me"] });

  // Silent production / consumption state
  const [silentProdOpen, setSilentProdOpen] = useState(false);
  const [silentProdType, setSilentProdType] = useState<"Production" | "Consumption">("Production");
  const [silentProdLocId, setSilentProdLocId] = useState("");
  const [silentProdItems, setSilentProdItems] = useState<{ stockItemId: string; quantity: string; rate: string }[]>([{ stockItemId: "", quantity: "", rate: "" }]);
  const [silentProdApplying, setSilentProdApplying] = useState(false);
  const [silentProdDone, setSilentProdDone] = useState(0);

  // Silent prod — Excel import state
  const [silentImportMode, setSilentImportMode] = useState(false);
  const [silentImportPreview, setSilentImportPreview] = useState<SilentImportRow[]>([]);
  const [silentImportLoading, setSilentImportLoading] = useState(false);
  const silentImportFileRef = useRef<HTMLInputElement>(null);

  // Silent inventory transfer state
  const [silentTransferOpen, setSilentTransferOpen] = useState(false);
  const [silentSrcId, setSilentSrcId] = useState("");
  const [silentDstId, setSilentDstId] = useState("");
  const [silentFile, setSilentFile] = useState<File | null>(null);
  const [silentValidItems, setSilentValidItems] = useState<any[]>([]);
  const [silentWarnItems, setSilentWarnItems] = useState<any[]>([]);
  const [silentErrorLines, setSilentErrorLines] = useState<any[]>([]);
  const [silentIncludeWarnings, setSilentIncludeWarnings] = useState(false);
  const [silentParseError, setSilentParseError] = useState("");
  const [silentStep, setSilentStep] = useState<"setup" | "validation" | "done">("setup");
  const [isSilentParsing, setIsSilentParsing] = useState(false);
  const [isSilentApplying, setIsSilentApplying] = useState(false);
  const [silentAppliedCount, setSilentAppliedCount] = useState(0);


  // Fetch locations for the current company
  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ["/api/locations", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  // Fetch stock items (for silent production picker)
  const { data: allStockItems = [] } = useQuery<any[]>({
    queryKey: ["/api/stock-items", selectedCompany?.id],
    enabled: !!selectedCompany && dtCurrentUser?.role === "Developer",
  });

  // Fetch location inventory for silent prod import preview
  const { data: silentLocSummary } = useQuery<any>({
    queryKey: ["/api/location-summary", silentProdLocId],
    queryFn: async () => {
      const res = await fetch(`/api/location-summary?locationIds=${silentProdLocId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!silentProdLocId && silentProdOpen && silentImportMode,
  });

  // Convert Bale to BL mutation
  const updateUOMMutation = useMutation({
    mutationFn: async () => {
      return await modeApiRequest("POST", "/api/stock-items/bulk-update-uom", {});
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      toast({
        title: "Success",
        description: data.message || "UOM updated successfully",
      });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to update UOM",
        variant: "destructive",
      });
    },
  });

  // Fix Cost Prices mutation
  const recalculateCostsMutation = useMutation({
    mutationFn: async () => {
      return modeApiRequest("POST", "/api/sales-report/recalculate-costs", {});
    },
    onSuccess: (data: any) => {
      toast({
        title: "Cost Prices Updated",
        description: `Updated ${data.updatedCount} of ${data.totalChecked} sales items`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-report"] });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Cost price import functions
  const downloadCostPriceTemplate = async () => {
    const template = [
      { barcode: "ITEM001", costPrice: "125.50" },
      { barcode: "ITEM002", costPrice: "95.75" },
    ];
    const ws = utils.json_to_sheet(template);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Cost Price Import");
    await writeFile(wb, "cost_price_import_template.xlsx");
    toast({
      title: "Template Downloaded",
      description: "Use this template to update cost prices",
    });
  };

  const handleCostPriceFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setCostPriceFile(selectedFile);
    setCostPriceErrors([]);
    setCostPricePreview([]);
    setCostPriceImportComplete(false);

    try {
      const data = await selectedFile.arrayBuffer();
      const workbook = await read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = utils.sheet_to_json<any>(worksheet);

      if (jsonData.length === 0) {
        toast({ title: "Empty File", description: "The Excel file is empty.", variant: "destructive" });
        return;
      }

      const headerRow = utils.sheet_to_json<string[]>(worksheet, { header: 1 })[0] || [];
      const columns = headerRow.map((h: any) => String(h || "").trim());
      const requiredCols = ["barcode", "costPrice"];
      const missingCols = requiredCols.filter(col => !columns.includes(col));
      
      if (missingCols.length > 0) {
        toast({
          title: "Missing Required Columns",
          description: `Expected: ${requiredCols.join(", ")}. Download template for format.`,
          variant: "destructive",
        });
        return;
      }

      const errors: string[] = [];
      const rows: Array<{ barcode: string; costPrice: number }> = [];

      jsonData.forEach((row: any, index: number) => {
        const rowNumber = index + 2;
        if (!row.barcode || String(row.barcode).trim() === "") {
          errors.push(`Row ${rowNumber}: Barcode is required`);
          return;
        }
        const costPrice = parseFloat(row.costPrice || "0");
        if (isNaN(costPrice) || costPrice <= 0) {
          errors.push(`Row ${rowNumber}: Cost price must be > 0`);
          return;
        }
        rows.push({ barcode: String(row.barcode).trim(), costPrice });
      });

      setCostPricePreview(rows);
      setCostPriceErrors(errors);
    } catch (error) {
      toast({ title: "Error Reading File", description: "Please ensure valid Excel file.", variant: "destructive" });
    }
  };

  const handleCostPriceImport = async () => {
    if (!costPriceLocationId) {
      toast({ title: "No Location Selected", description: "Please select a location first", variant: "destructive" });
      return;
    }
    if (costPriceErrors.length > 0) {
      toast({ title: "Cannot Import", description: "Please fix validation errors first", variant: "destructive" });
      return;
    }

    setIsImportingCostPrice(true);
    try {
      const res = await modeApiRequest("POST", `/api/locations/${costPriceLocationId}/import-cost-prices`, {
        updates: costPricePreview,
      });
      const response = await res.json();
      queryClient.invalidateQueries({ queryKey: [`/api/locations/${costPriceLocationId}/inventory`] });
      setCostPriceImportComplete(true);
      toast({
        title: "Import Successful",
        description: `Updated ${response.updated} cost prices.`,
      });
    } catch (error: any) {
      toast({ title: "Import Failed", description: error.message || "Failed to import", variant: "destructive" });
    } finally {
      setIsImportingCostPrice(false);
    }
  };

  const handleCostPriceDialogClose = async () => {
    setCostPriceImportOpen(false);
    setCostPriceFile(null);
    setCostPricePreview([]);
    setCostPriceErrors([]);
    setCostPriceImportComplete(false);
  };

  // Stock import functions
  const downloadStockTemplate = async () => {
    const template = [
      { Item_barcode: "ITEM-001", stockGroupCode: "GRP01", quantity: "100", rate: "50.00", value: "5000.00" },
      { Item_barcode: "ITEM-002", stockGroupCode: "GRP02", quantity: "50", rate: "100.00", value: "5000.00" },
    ];
    const ws = utils.json_to_sheet(template);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Stock Import");
    await writeFile(wb, "stock_import_template.xlsx");
    toast({ title: "Template Downloaded", description: "Use this template to import stock" });
  };

  const handleStockFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setStockFile(selectedFile);
    setStockErrors([]);
    setStockPreview([]);
    setStockImportComplete(false);

    try {
      const data = await selectedFile.arrayBuffer();
      const workbook = await read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = utils.sheet_to_json<any>(worksheet);

      if (jsonData.length === 0) {
        toast({ title: "Empty File", description: "The Excel file is empty.", variant: "destructive" });
        return;
      }

      const headerRow = utils.sheet_to_json<string[]>(worksheet, { header: 1 })[0] || [];
      const columns = headerRow.map((h: any) => String(h || "").trim());
      const requiredCols = ["Item_barcode", "quantity", "rate", "value"];
      const missingCols = requiredCols.filter(col => !columns.includes(col));
      
      if (missingCols.length > 0) {
        toast({
          title: "Missing Required Columns",
          description: `Expected: ${requiredCols.join(", ")}. Download template for format.`,
          variant: "destructive",
        });
        return;
      }

      const errors: string[] = [];
      const rows: Array<{ Item_barcode: string; stockGroupCode?: string; quantity: string; rate: string; value: string }> = [];

      jsonData.forEach((row: any, index: number) => {
        const rowNumber = index + 2;
        if (!row.Item_barcode || String(row.Item_barcode).trim() === "") {
          errors.push(`Row ${rowNumber}: Item_barcode is required`);
          return;
        }
        const quantity = parseFloat(row.quantity || "0");
        const rate = parseFloat(row.rate || "0");
        const value = parseFloat(row.value || "0");
        if (isNaN(quantity) || quantity === 0) {
          errors.push(`Row ${rowNumber}: Quantity must be a non-zero number (negative quantities are allowed)`);
          return;
        }
        if (isNaN(rate) || rate < 0) {
          errors.push(`Row ${rowNumber}: Rate must be >= 0`);
          return;
        }
        rows.push({
          Item_barcode: String(row.Item_barcode).trim(),
          stockGroupCode: row.stockGroupCode ? String(row.stockGroupCode).trim() : undefined,
          quantity: String(quantity),
          rate: String(rate),
          value: String(value),
        });
      });

      setStockPreview(rows);
      setStockErrors(errors);
    } catch (error) {
      toast({ title: "Error Reading File", description: "Please ensure valid Excel file.", variant: "destructive" });
    }
  };

  const handleStockImport = async () => {
    if (!stockLocationId) {
      toast({ title: "No Location Selected", description: "Please select a location first", variant: "destructive" });
      return;
    }
    if (stockErrors.length > 0) {
      toast({ title: "Cannot Import", description: "Please fix validation errors first", variant: "destructive" });
      return;
    }

    setIsImportingStock(true);
    try {
      const res = await modeApiRequest("POST", `/api/locations/${stockLocationId}/import-inventory`, {
        items: stockPreview,
      });
      const response = await res.json();
      queryClient.invalidateQueries({ queryKey: [`/api/locations/${stockLocationId}/inventory`] });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      setStockImportComplete(true);
      toast({
        title: "Import Successful",
        description: `Imported ${response.imported || stockPreview.length} inventory items`,
      });
    } catch (error: any) {
      toast({ title: "Import Failed", description: error.message || "Failed to import", variant: "destructive" });
    } finally {
      setIsImportingStock(false);
    }
  };

  const handleStockDialogClose = async () => {
    setStockImportOpen(false);
    setStockFile(null);
    setStockPreview([]);
    setStockErrors([]);
    setStockImportComplete(false);
  };

  // Silent prod — Excel import helpers
  const downloadSilentTemplate = async () => {
    const wb = utils.book_new();
    const ws = wb.addWorksheet("Silent Adjustment");
    ws.addRow(["Code", "Name", "Qty Change", "Rate"]);
    ws.getRow(1).font = { bold: true };
    ws.getColumn(1).width = 16;
    ws.getColumn(2).width = 36;
    ws.getColumn(3).width = 14;
    ws.getColumn(4).width = 12;
    ws.addRow(["ABC123", "Example Item A", 50, 10.5]);
    ws.addRow(["XYZ456", "Example Item B", -20, ""]);
    ws.getRow(2).font = { italic: true, color: { argb: "FF999999" } };
    ws.getRow(3).font = { italic: true, color: { argb: "FF999999" } };
    await writeFile(wb, "silent_adjustment_template.xlsx");
    toast({ title: "Template Downloaded" });
  };

  const getCurrentQty = (stockItemId: number): number => {
    if (!silentLocSummary?.stockGroups) return 0;
    const locId = parseInt(silentProdLocId);
    for (const group of silentLocSummary.stockGroups) {
      const item = group.items?.find((i: any) => i.id === stockItemId);
      if (item?.locationData?.[locId]) return item.locationData[locId].quantity || 0;
    }
    return 0;
  };

  const handleSilentImportFile = async (file: File) => {
    setSilentImportLoading(true);
    try {
      const wb = await readFile(file);
      const ws = wb.getWorksheet(1);
      if (!ws) { toast({ title: "Error", description: "Could not read worksheet", variant: "destructive" }); return; }
      const rows = utils.sheet_to_json<{ Code?: any; Name?: any; "Qty Change"?: any; "Item Name"?: any; Change?: any; Rate?: any }>(ws);

      const preview: SilentImportRow[] = rows
        .filter(row => row.Code !== undefined || row.Name !== undefined || row["Item Name"] !== undefined)
        .map(row => {
          const code = String(row.Code ?? "").trim();
          const name = String(row.Name ?? row["Item Name"] ?? "").trim();
          const change = parseFloat(String(row["Qty Change"] ?? row.Change ?? "0")) || 0;
          const rate = parseFloat(String(row.Rate ?? "0")) || 0;

          let matched: any = code ? (allStockItems as any[]).find((s: any) => s.code?.toLowerCase() === code.toLowerCase()) : undefined;
          if (!matched && name) matched = (allStockItems as any[]).find((s: any) => s.name.toLowerCase() === name.toLowerCase());

          if (!matched) {
            return { rawCode: code, rawName: name, stockItemId: null, stockItemName: name || code || "Unknown", currentQty: 0, change, newQty: Math.max(0, change), rate, status: "not_found" as const };
          }

          const currentQty = getCurrentQty(matched.id);
          const newQty = currentQty + change;
          const status: SilentImportRow["status"] = newQty <= 0 ? "to_zero" : "ok";
          return { rawCode: code, rawName: name, stockItemId: matched.id, stockItemName: matched.name, currentQty, change, newQty: Math.max(0, newQty), rate, status };
        });

      setSilentImportPreview(preview);
    } catch (err: any) {
      toast({ title: "Parse Error", description: err.message || "Failed to read file", variant: "destructive" });
    } finally {
      setSilentImportLoading(false);
    }
  };

  const exportSilentExcel = async () => {
    const wb = utils.book_new();
    const ws = wb.addWorksheet("Adjustment");
    ws.addRow(["Item Name", "Qty"]);
    ws.getRow(1).font = { bold: true };
    for (const row of silentImportPreview.filter(r => r.status !== "not_found")) {
      ws.addRow([row.stockItemName, row.newQty]);
    }
    ws.getColumn(1).width = 36;
    ws.getColumn(2).width = 12;
    await writeFile(wb, "silent_adjustment_preview.xlsx");
  };

  const exportSilentPDF = async () => {
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    doc.setFontSize(14);
    doc.text("Silent Adjustment Preview", 14, 18);
    doc.setFontSize(10);
    doc.text(`Location: ${(locations as any[]).find((l: any) => String(l.id) === silentProdLocId)?.name || ""}   Date: ${new Date().toLocaleDateString()}`, 14, 25);
    const rows = silentImportPreview.filter(r => r.status !== "not_found").map((r, i) => [i + 1, r.stockItemName, r.newQty]);
    autoTable(doc, { startY: 30, head: [["#", "Item Name", "New Qty"]], body: rows, styles: { fontSize: 9 }, headStyles: { fillColor: [30, 30, 30] }, columnStyles: { 0: { cellWidth: 12 }, 2: { cellWidth: 22, halign: "right" } } });
    doc.save("silent_adjustment_preview.pdf");
  };

  const applySilentImport = async () => {
    const valid = silentImportPreview.filter(r => r.stockItemId !== null && r.status !== "not_found");
    const productions = valid.filter(r => r.change > 0);
    const consumptions = valid.filter(r => r.change < 0);
    if (valid.length === 0) return;
    setSilentProdApplying(true);
    try {
      let totalApplied = 0;
      if (productions.length > 0) {
        const res = await apiRequest("POST", "/api/inventory/silent-production", {
          locationId: silentProdLocId,
          type: "Production",
          items: productions.map(r => ({ stockItemId: String(r.stockItemId), quantity: String(Math.abs(r.change)), rate: String(r.rate) })),
        });
        const d = await res.json();
        totalApplied += d.applied || productions.length;
      }
      if (consumptions.length > 0) {
        const res = await apiRequest("POST", "/api/inventory/silent-production", {
          locationId: silentProdLocId,
          type: "Consumption",
          items: consumptions.map(r => ({ stockItemId: String(r.stockItemId), quantity: String(Math.abs(r.change)), rate: "0" })),
        });
        const d = await res.json();
        totalApplied += d.applied || consumptions.length;
      }
      setSilentProdDone(totalApplied);
      setSilentImportPreview([]);
      setSilentImportMode(false);
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-by-location"] });
      queryClient.invalidateQueries({ queryKey: ["/api/location-summary"] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSilentProdApplying(false);
    }
  };

  if (!selectedCompany) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          <h2 className="text-2xl font-semibold">Data Tools</h2>
        </div>
        <p className="text-muted-foreground">
          Please select a company to access data tools.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Database className="h-5 w-5" />
        <h2 className="text-2xl font-semibold">Data Tools</h2>
      </div>
      <p className="text-muted-foreground">
        Administrative utilities for bulk data operations and maintenance tasks.
      </p>

      {appMode === "factory" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Import Data
            </CardTitle>
            <CardDescription>
              Import factory data including bales, raw stock, opening balances, and production records
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/factory/import">
              <button
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                data-testid="button-go-to-import"
              >
                <Upload className="h-4 w-4" />
                Open Import Tool
              </button>
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Import Cost Prices Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Import Cost Prices
            </CardTitle>
            <CardDescription>
              Bulk update inventory cost prices from Excel file
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Select Location</Label>
              <Select value={costPriceLocationId} onValueChange={setCostPriceLocationId}>
                <SelectTrigger data-testid="select-location-cost-price">
                  <SelectValue placeholder="Choose location..." />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc: any) => (
                    <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setCostPriceImportOpen(true)}
              disabled={!costPriceLocationId}
              data-testid="button-open-cost-price-import"
            >
              <Upload className="h-4 w-4 mr-2" />
              Import Cost Prices
            </Button>
          </CardContent>
        </Card>

        {/* Import Stock Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Import Stock
            </CardTitle>
            <CardDescription>
              Bulk import inventory quantities from Excel file
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Select Location</Label>
              <Select value={stockLocationId} onValueChange={setStockLocationId}>
                <SelectTrigger data-testid="select-location-stock-import">
                  <SelectValue placeholder="Choose location..." />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc: any) => (
                    <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setStockImportOpen(true)}
              disabled={!stockLocationId}
              data-testid="button-open-stock-import"
            >
              <Upload className="h-4 w-4 mr-2" />
              Import Stock
            </Button>
          </CardContent>
        </Card>

        {/* Convert Bale to BL Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Convert Bale to BL
            </CardTitle>
            <CardDescription>
              Update all stock items with "Bale" UOM to "BL"
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => updateUOMMutation.mutate()}
              disabled={updateUOMMutation.isPending}
              data-testid="button-convert-bale-bl"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${updateUOMMutation.isPending ? "animate-spin" : ""}`} />
              {updateUOMMutation.isPending ? "Converting..." : "Convert Bale to BL"}
            </Button>
          </CardContent>
        </Card>

        {/* Fix Cost Prices Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Fix Cost Prices
            </CardTitle>
            <CardDescription>
              Recalculate sales cost prices based on inventory records
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => recalculateCostsMutation.mutate()}
              disabled={recalculateCostsMutation.isPending}
              data-testid="button-fix-cost-prices"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${recalculateCostsMutation.isPending ? "animate-spin" : ""}`} />
              {recalculateCostsMutation.isPending ? "Updating..." : "Fix Cost Prices"}
            </Button>
          </CardContent>
        </Card>

        {/* Silent Stock Transfer Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4" />
              Silent Stock Transfer
            </CardTitle>
            <CardDescription>
              Move stock between locations via Excel upload — no daybook entry created
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => { setSilentStep("setup"); setSilentValidItems([]); setSilentWarnItems([]); setSilentErrorLines([]); setSilentParseError(""); setSilentFile(null); setSilentAppliedCount(0); setSilentTransferOpen(true); }}
              data-testid="button-open-silent-transfer"
            >
              <ArrowLeftRight className="h-4 w-4 mr-2" />
              Open Silent Transfer
            </Button>
          </CardContent>
        </Card>

        {/* Silent Production / Consumption — Developer only, ERP mode only */}
        {dtCurrentUser?.role === "Developer" && appMode !== "factory" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-4 w-4" />
                Silent Production / Consumption
              </CardTitle>
              <CardDescription>
                Directly adjust inventory up (Production) or down (Consumption) — no daybook entry, developer only
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => { setSilentProdType("Production"); setSilentProdLocId(""); setSilentProdItems([{ stockItemId: "", quantity: "", rate: "" }]); setSilentProdDone(0); setSilentImportMode(false); setSilentImportPreview([]); setSilentProdOpen(true); }}
                data-testid="button-open-silent-production"
              >
                <Package className="h-4 w-4 mr-2" />
                Open Silent Production / Consumption
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Merge Duplicate Stock Items — ERP mode, Admin/Owner/Developer */}
        {appMode !== "factory" && ["Admin", "Owner", "Developer"].includes(dtCurrentUser?.role || "") && selectedCompany && (
          <MergeStockItemsCard />
        )}

        {/* Bulk Merge via Excel — ERP mode, Developer only */}
        {appMode !== "factory" && dtCurrentUser?.role === "Developer" && selectedCompany && (
          <BulkMergeStockItemsCard />
        )}

        {/* Merge History / Unmerge — ERP mode, Admin/Owner/Developer */}
        {appMode !== "factory" && ["Admin", "Owner", "Developer"].includes(dtCurrentUser?.role || "") && selectedCompany && (
          <MergeHistoryCard />
        )}

        {/* Merge Bale Products — factory mode, Admin/Owner/Developer */}
        {appMode === "factory" && ["Admin", "Owner", "Developer"].includes(dtCurrentUser?.role || "") && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowLeftRight className="h-4 w-4" />
                Merge Bale Products
              </CardTitle>
              <CardDescription>
                Combine duplicate bale product entries — all bales from the selected items move to the one you keep, and the duplicates are deactivated
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/factory/merge-bale-products">
                <Button variant="outline" className="w-full" data-testid="button-open-merge-products">
                  <ArrowLeftRight className="h-4 w-4 mr-2" />
                  Open Merge Tool
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Silent Production / Consumption Dialog */}
      {dtCurrentUser?.role === "Developer" && appMode !== "factory" && (
        <Dialog open={silentProdOpen} onOpenChange={(o) => { if (!silentProdApplying) setSilentProdOpen(o); }}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Silent Production / Consumption</DialogTitle>
              <DialogDescription>
                Adjusts inventory directly without creating any accounting or daybook entries. Developer use only.
              </DialogDescription>
            </DialogHeader>

            {silentProdDone > 0 ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <Check className="h-5 w-5" />
                  <p className="font-semibold">Applied {silentProdDone} item(s) silently</p>
                </div>
                <Button variant="outline" onClick={() => setSilentProdOpen(false)} data-testid="button-silent-prod-close">Close</Button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Mode toggle */}
                <div className="flex gap-2 border-b pb-3">
                  <Button
                    variant={!silentImportMode ? "default" : "outline"}
                    size="sm"
                    onClick={() => { setSilentImportMode(false); setSilentImportPreview([]); }}
                    data-testid="button-mode-manual"
                  >
                    Manual Entry
                  </Button>
                  <Button
                    variant={silentImportMode ? "default" : "outline"}
                    size="sm"
                    onClick={() => { setSilentImportMode(true); }}
                    data-testid="button-mode-import"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5 mr-1" />
                    Import from Excel
                  </Button>
                </div>

                {/* Location (shared between modes) */}
                <div className="space-y-1">
                  <Label>Location</Label>
                  <Select value={silentProdLocId} onValueChange={setSilentProdLocId}>
                    <SelectTrigger data-testid="select-silent-prod-location">
                      <SelectValue placeholder="Select location..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(locations as any[]).map((loc: any) => (
                        <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {!silentImportMode ? (
                  <>
                    {/* Type toggle — manual mode only */}
                    <div className="flex gap-2">
                      <Button variant={silentProdType === "Production" ? "default" : "outline"} size="sm" onClick={() => setSilentProdType("Production")} data-testid="button-type-production">Production (+)</Button>
                      <Button variant={silentProdType === "Consumption" ? "default" : "outline"} size="sm" onClick={() => setSilentProdType("Consumption")} data-testid="button-type-consumption">Consumption (−)</Button>
                    </div>

                    {/* Items table */}
                    <div className="space-y-2">
                      <Label>Items</Label>
                      <div className="space-y-2">
                        {silentProdItems.map((item, idx) => (
                          <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                            <div className="col-span-5">
                              <Select value={item.stockItemId} onValueChange={(v) => setSilentProdItems(prev => prev.map((r, i) => i === idx ? { ...r, stockItemId: v } : r))}>
                                <SelectTrigger data-testid={`select-prod-item-${idx}`}><SelectValue placeholder="Stock item..." /></SelectTrigger>
                                <SelectContent>
                                  {(allStockItems as any[]).map((si: any) => <SelectItem key={si.id} value={String(si.id)}>{si.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="col-span-3">
                              <Input type="number" placeholder="Qty" value={item.quantity} onChange={(e) => setSilentProdItems(prev => prev.map((r, i) => i === idx ? { ...r, quantity: e.target.value } : r))} data-testid={`input-prod-qty-${idx}`} />
                            </div>
                            <div className="col-span-3">
                              <Input type="number" placeholder={silentProdType === "Production" ? "Rate" : "Rate (opt)"} value={item.rate} onChange={(e) => setSilentProdItems(prev => prev.map((r, i) => i === idx ? { ...r, rate: e.target.value } : r))} data-testid={`input-prod-rate-${idx}`} />
                            </div>
                            <div className="col-span-1 flex justify-center">
                              <Button size="icon" variant="ghost" onClick={() => setSilentProdItems(prev => prev.filter((_, i) => i !== idx))} disabled={silentProdItems.length === 1} data-testid={`button-remove-prod-row-${idx}`}><X className="h-4 w-4" /></Button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setSilentProdItems(prev => [...prev, { stockItemId: "", quantity: "", rate: "" }])} data-testid="button-add-prod-row">
                        <Plus className="h-4 w-4 mr-1" />Add Item
                      </Button>
                    </div>

                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setSilentProdOpen(false)} data-testid="button-silent-prod-cancel">Cancel</Button>
                      <Button
                        disabled={!silentProdLocId || silentProdItems.every(r => !r.stockItemId || !r.quantity) || silentProdApplying}
                        onClick={async () => {
                          const validItems = silentProdItems.filter(r => r.stockItemId && r.quantity);
                          if (!silentProdLocId || validItems.length === 0) return;
                          setSilentProdApplying(true);
                          try {
                            const res = await apiRequest("POST", "/api/inventory/silent-production", { locationId: silentProdLocId, type: silentProdType, items: validItems.map(r => ({ stockItemId: r.stockItemId, quantity: r.quantity, rate: r.rate || "0" })) });
                            const data = await res.json();
                            setSilentProdDone(data.applied || validItems.length);
                          } catch (err: any) { console.error("Silent production error:", err); } finally { setSilentProdApplying(false); }
                        }}
                        data-testid="button-silent-prod-apply"
                      >
                        {silentProdApplying ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Applying...</> : `Apply ${silentProdType}`}
                      </Button>
                    </div>
                  </>
                ) : (
                  /* Import from Excel mode */
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Upload an Excel file with <strong>Code</strong>, <strong>Name</strong>, <strong>Qty Change</strong>, <strong>Rate</strong> columns.
                      Positive qty = Production (+), Negative qty = Consumption (−). Both can be in the same file.
                    </p>

                    {silentImportPreview.length === 0 ? (
                      <div className="space-y-3">
                        <Button variant="outline" size="sm" onClick={downloadSilentTemplate} data-testid="button-download-silent-template">
                          <FileDown className="h-4 w-4 mr-1" />Download Template
                        </Button>
                        <label
                          className="flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-md p-8 cursor-pointer hover-elevate text-muted-foreground"
                          data-testid="label-silent-import-dropzone"
                          onDragOver={e => e.preventDefault()}
                          onDrop={e => { e.preventDefault(); if (!silentProdLocId) { toast({ title: "Select a location first", variant: "destructive" }); return; } const f = e.dataTransfer.files[0]; if (f) handleSilentImportFile(f); }}
                        >
                          <input ref={silentImportFileRef} type="file" accept=".xlsx,.xls" className="hidden" data-testid="input-silent-import-file"
                            onChange={e => { if (!silentProdLocId) { toast({ title: "Select a location first", variant: "destructive" }); return; } const f = e.target.files?.[0]; if (f) handleSilentImportFile(f); e.target.value = ""; }} />
                          <Upload className="h-8 w-8 opacity-40" />
                          <span className="text-sm font-medium">{silentImportLoading ? "Parsing…" : "Click or drag & drop Excel file"}</span>
                          <span className="text-xs">.xlsx / .xls — select a location first</span>
                        </label>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex gap-3 text-xs font-medium">
                            <span className="text-emerald-600 dark:text-emerald-400">{silentImportPreview.filter(r => r.change > 0 && r.status !== 'not_found').length} production</span>
                            <span className="text-destructive">{silentImportPreview.filter(r => r.change < 0 && r.status !== 'not_found').length} consumption</span>
                            {silentImportPreview.filter(r => r.status === 'not_found').length > 0 && <span className="text-muted-foreground">{silentImportPreview.filter(r => r.status === 'not_found').length} unmatched</span>}
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={exportSilentExcel} data-testid="button-export-silent-excel"><FileDown className="h-3 w-3 mr-1" />Excel</Button>
                            <Button variant="outline" size="sm" onClick={exportSilentPDF} data-testid="button-export-silent-pdf"><FileDown className="h-3 w-3 mr-1" />PDF</Button>
                            <Button variant="ghost" size="sm" onClick={() => { setSilentImportPreview([]); if (silentImportFileRef.current) silentImportFileRef.current.value = ""; }} data-testid="button-clear-silent-import">Clear</Button>
                          </div>
                        </div>

                        <div className="border rounded-md overflow-hidden text-sm">
                          <div className="max-h-[280px] overflow-y-auto">
                            <table className="w-full">
                              <thead className="bg-muted/50 sticky top-0">
                                <tr>
                                  <th className="text-left p-2 font-medium">Item</th>
                                  <th className="text-right p-2 font-medium">Current</th>
                                  <th className="text-right p-2 font-medium">Change</th>
                                  <th className="text-right p-2 font-medium">New Qty</th>
                                </tr>
                              </thead>
                              <tbody>
                                {silentImportPreview.map((row, idx) => (
                                  <tr key={idx} className={`border-t ${row.status === 'not_found' ? 'opacity-50' : ''}`}>
                                    <td className="p-2">
                                      <p className="font-medium truncate max-w-[220px]">{row.stockItemName}</p>
                                      {row.status === 'not_found' && <p className="text-xs text-destructive">Not found — skipped</p>}
                                      {row.status === 'to_zero' && <p className="text-xs text-amber-600 dark:text-amber-400">Will reach 0</p>}
                                    </td>
                                    <td className="p-2 text-right font-mono text-muted-foreground">{formatNumber(row.currentQty, 0)}</td>
                                    <td className={`p-2 text-right font-mono font-semibold ${row.change > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>
                                      <span className="inline-flex items-center gap-0.5 justify-end">
                                        {row.change > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                        {row.change > 0 ? "+" : ""}{formatNumber(row.change, 0)}
                                      </span>
                                    </td>
                                    <td className="p-2 text-right font-mono font-semibold">{row.status !== 'not_found' ? formatNumber(row.newQty, 0) : "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Button variant="outline" onClick={() => setSilentProdOpen(false)} data-testid="button-silent-import-cancel">Cancel</Button>
                          <Button
                            onClick={applySilentImport}
                            disabled={silentProdApplying || silentImportPreview.every(r => r.status === 'not_found') || !silentProdLocId}
                            data-testid="button-silent-import-apply"
                          >
                            {silentProdApplying ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Applying…</> : "Apply Adjustments"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* Silent Transfer Dialog */}
      <Dialog open={silentTransferOpen} onOpenChange={(o) => { if (!isSilentParsing && !isSilentApplying) setSilentTransferOpen(o); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Silent Stock Transfer</DialogTitle>
            <DialogDescription>
              Upload an Excel file to move stock between locations without creating a daybook entry.
            </DialogDescription>
          </DialogHeader>

          {/* STEP 1 — Setup */}
          {silentStep === "setup" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Source Location</Label>
                  <Select value={silentSrcId} onValueChange={setSilentSrcId}>
                    <SelectTrigger data-testid="select-silent-source">
                      <SelectValue placeholder="From location..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(locations as any[]).map((loc: any) => (
                        <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Destination Location</Label>
                  <Select value={silentDstId} onValueChange={setSilentDstId}>
                    <SelectTrigger data-testid="select-silent-destination">
                      <SelectValue placeholder="To location..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(locations as any[]).filter((l: any) => String(l.id) !== silentSrcId).map((loc: any) => (
                        <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="silent-transfer-file">Excel File</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => window.open("/api/inventory/silent-transfer/template", "_blank")}
                    data-testid="button-silent-transfer-template"
                  >
                    <Download className="h-4 w-4 mr-1" />
                    Download Template
                  </Button>
                </div>
                <Input
                  id="silent-transfer-file"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => setSilentFile(e.target.files?.[0] ?? null)}
                  data-testid="input-silent-transfer-file"
                />
                {silentFile && <p className="text-sm text-muted-foreground">Selected: {silentFile.name}</p>}
              </div>

              <p className="text-xs text-muted-foreground">
                Template columns: <strong>Barcode</strong> (item code), <strong>Quantity</strong> — duplicate barcodes are detected automatically.
              </p>

              {silentParseError && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{silentParseError}</AlertDescription>
                </Alert>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setSilentTransferOpen(false)}>Cancel</Button>
                <Button
                  onClick={async () => {
                    if (!silentSrcId || !silentDstId || !silentFile) return;
                    setIsSilentParsing(true);
                    setSilentParseError("");
                    try {
                      const formData = new FormData();
                      formData.append("file", silentFile);
                      formData.append("sourceLocationId", silentSrcId);
                      formData.append("destinationLocationId", silentDstId);
                      const res = await fetch("/api/inventory/silent-transfer/parse", {
                        method: "POST",
                        body: formData,
                        credentials: "include",
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.message);
                      setSilentValidItems(data.validItems || []);
                      setSilentWarnItems(data.warnItems || []);
                      setSilentErrorLines(data.errorLines || []);
                      setSilentIncludeWarnings(false);
                      setSilentStep("validation");
                    } catch (err: any) {
                      setSilentParseError(err.message);
                    } finally {
                      setIsSilentParsing(false);
                    }
                  }}
                  disabled={!silentSrcId || !silentDstId || !silentFile || isSilentParsing}
                  data-testid="button-silent-transfer-parse"
                >
                  {isSilentParsing
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Validating...</>
                    : "Validate File"}
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* STEP 2 — Validation results */}
          {silentStep === "validation" && (() => {
            const applyItems = silentIncludeWarnings
              ? [...silentValidItems, ...silentWarnItems]
              : silentValidItems;
            return (
              <div className="space-y-4">
                {/* Summary row */}
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1 rounded-md bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 text-xs font-medium px-2 py-1">
                    <CheckCircle2 className="h-3 w-3" />
                    {silentValidItems.length} valid
                  </span>
                  {silentWarnItems.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 text-xs font-medium px-2 py-1">
                      <AlertTriangle className="h-3 w-3" />
                      {silentWarnItems.length} insufficient stock
                    </span>
                  )}
                  {silentErrorLines.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 text-xs font-medium px-2 py-1">
                      <AlertTriangle className="h-3 w-3" />
                      {silentErrorLines.length} error{silentErrorLines.length !== 1 ? "s" : ""} (excluded)
                    </span>
                  )}
                </div>

                <div className="max-h-[380px] overflow-y-auto space-y-3 pr-1">

                  {/* Error rows */}
                  {silentErrorLines.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-destructive mb-1">Errors — excluded from transfer</p>
                      <div className="rounded-md border border-destructive/30 overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs py-2 w-14">Row</TableHead>
                              <TableHead className="text-xs py-2">Barcode</TableHead>
                              <TableHead className="text-xs py-2">Reason</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {silentErrorLines.map((e: any, i: number) => (
                              <TableRow key={i} className="bg-red-50/60 dark:bg-red-950/20">
                                <TableCell className="text-xs py-1.5 text-muted-foreground">{e.rowNum}</TableCell>
                                <TableCell className="text-xs py-1.5 font-mono">{e.barcode || "—"}</TableCell>
                                <TableCell className="text-xs py-1.5 text-destructive">{e.reason}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {/* Warning rows — insufficient stock */}
                  {silentWarnItems.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400">
                          Insufficient Stock — will go negative
                        </p>
                        <label className="flex items-center gap-1.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={silentIncludeWarnings}
                            onChange={(e) => setSilentIncludeWarnings(e.target.checked)}
                            data-testid="checkbox-include-warnings"
                            className="h-3.5 w-3.5 rounded"
                          />
                          <span className="text-xs text-muted-foreground">Include anyway</span>
                        </label>
                      </div>
                      <div className={`rounded-md border overflow-hidden transition-opacity ${silentIncludeWarnings ? "border-yellow-300 dark:border-yellow-700/50 opacity-100" : "border-muted opacity-60"}`}>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs py-2">Item</TableHead>
                              <TableHead className="text-right text-xs py-2">Qty</TableHead>
                              <TableHead className="text-right text-xs py-2">Available</TableHead>
                              <TableHead className="text-xs py-2">Issue</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {silentWarnItems.map((item: any, i: number) => (
                              <TableRow key={i} className={silentIncludeWarnings ? "bg-yellow-50/60 dark:bg-yellow-950/20" : ""}>
                                <TableCell className="py-1.5">
                                  <div className="text-xs font-medium">{item.stockItemName}</div>
                                  <div className="text-xs text-muted-foreground font-mono">{item.barcode}</div>
                                </TableCell>
                                <TableCell className="text-right text-xs py-1.5">{formatNumber(item.quantity)}</TableCell>
                                <TableCell className="text-right text-xs py-1.5 text-destructive font-medium">{formatNumber(item.currentStock)}</TableCell>
                                <TableCell className="text-xs py-1.5 text-yellow-700 dark:text-yellow-400">{item.warnReason}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {/* Valid items */}
                  {silentValidItems.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-1">
                        Valid — ready to transfer
                      </p>
                      <div className="rounded-md border border-green-200 dark:border-green-800/40 overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs py-2">Item</TableHead>
                              <TableHead className="text-right text-xs py-2">Qty</TableHead>
                              <TableHead className="text-right text-xs py-2">Stock</TableHead>
                              <TableHead className="text-right text-xs py-2">After</TableHead>
                              <TableHead className="text-right text-xs py-2">Rate</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {silentValidItems.map((item: any, i: number) => (
                              <TableRow key={i} className="bg-green-50/40 dark:bg-green-950/10">
                                <TableCell className="py-1.5">
                                  <div className="text-xs font-medium">{item.stockItemName}</div>
                                  <div className="text-xs text-muted-foreground font-mono">{item.barcode}</div>
                                </TableCell>
                                <TableCell className="text-right text-xs py-1.5">{formatNumber(item.quantity)}</TableCell>
                                <TableCell className="text-right text-xs py-1.5">{formatNumber(item.currentStock)}</TableCell>
                                <TableCell className="text-right text-xs py-1.5 text-green-700 dark:text-green-400 font-medium">
                                  {formatNumber(item.afterTransfer)}
                                </TableCell>
                                <TableCell className="text-right text-xs py-1.5 text-muted-foreground">{formatNumber(item.averageRate, 2)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {silentValidItems.length === 0 && silentWarnItems.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      No transferable items found in the file.
                    </p>
                  )}
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setSilentStep("setup")} disabled={isSilentApplying}>Back</Button>
                  <Button
                    onClick={async () => {
                      if (applyItems.length === 0) return;
                      setIsSilentApplying(true);
                      try {
                        const res = await apiRequest("POST", "/api/inventory/silent-transfer/apply", {
                          sourceLocationId: parseInt(silentSrcId),
                          destinationLocationId: parseInt(silentDstId),
                          items: applyItems,
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.message);
                        queryClient.invalidateQueries({ queryKey: ["/api/inventory-by-location"] });
                        queryClient.invalidateQueries({ queryKey: ["/api/location-summary"] });
                        setSilentAppliedCount(applyItems.length);
                        setSilentStep("done");
                      } catch (err: any) {
                        setSilentParseError(err.message);
                        setSilentStep("setup");
                      } finally {
                        setIsSilentApplying(false);
                      }
                    }}
                    disabled={applyItems.length === 0 || isSilentApplying}
                    data-testid="button-silent-transfer-apply"
                  >
                    {isSilentApplying
                      ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Applying...</>
                      : applyItems.length === 0
                        ? "No items to transfer"
                        : `Apply Transfer (${applyItems.length} item${applyItems.length !== 1 ? "s" : ""})`}
                  </Button>
                </DialogFooter>
              </div>
            );
          })()}

          {/* STEP 3 — Done */}
          {silentStep === "done" && (
            <div className="flex flex-col items-center gap-4 py-6">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <div className="text-center">
                <p className="font-semibold text-lg">Transfer Complete</p>
                <p className="text-sm text-muted-foreground">
                  {silentAppliedCount} item{silentAppliedCount !== 1 ? "s" : ""} moved silently. No daybook entry was created.
                </p>
              </div>
              <Button
                onClick={() => {
                  setSilentTransferOpen(false);
                  setSilentStep("setup");
                  setSilentSrcId("");
                  setSilentDstId("");
                  setSilentFile(null);
                  setSilentValidItems([]);
                  setSilentWarnItems([]);
                  setSilentErrorLines([]);
                  setSilentParseError("");
                  setSilentAppliedCount(0);
                }}
                data-testid="button-silent-transfer-close"
              >Close</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Cost Price Import Dialog */}
      <Dialog open={costPriceImportOpen} onOpenChange={handleCostPriceDialogClose}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Cost Prices from Excel</DialogTitle>
            <DialogDescription>
              Upload an Excel file with barcode and costPrice columns
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Button variant="outline" onClick={downloadCostPriceTemplate} size="sm" data-testid="button-download-cost-price-template">
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
            <div className="space-y-2">
              <Label htmlFor="cost-price-file">Select Excel File</Label>
              <Input
                id="cost-price-file"
                type="file"
                accept=".xlsx,.xls"
                onChange={handleCostPriceFileChange}
                disabled={isImportingCostPrice || costPriceImportComplete}
                data-testid="input-cost-price-file"
              />
              {costPriceFile && <p className="text-sm text-muted-foreground">Selected: {costPriceFile.name}</p>}
            </div>
            {costPriceErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <div className="font-semibold mb-2">{costPriceErrors.length} validation error(s):</div>
                  <ul className="list-disc list-inside space-y-1">
                    {costPriceErrors.slice(0, 5).map((err, i) => <li key={i} className="text-sm">{err}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {costPricePreview.length > 0 && costPriceErrors.length === 0 && (
              <Alert>
                <Package className="h-4 w-4" />
                <AlertDescription>{costPricePreview.length} records ready to import</AlertDescription>
              </Alert>
            )}
            {costPriceImportComplete && (
              <Alert>
                <Package className="h-4 w-4" />
                <AlertDescription>Cost prices imported successfully</AlertDescription>
              </Alert>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={handleCostPriceDialogClose} disabled={isImportingCostPrice}>Close</Button>
              <Button
                onClick={handleCostPriceImport}
                disabled={costPricePreview.length === 0 || costPriceErrors.length > 0 || isImportingCostPrice || costPriceImportComplete}
                data-testid="button-submit-cost-price-import"
              >
                {isImportingCostPrice ? "Importing..." : "Import Cost Prices"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Stock Import Dialog */}
      <Dialog open={stockImportOpen} onOpenChange={handleStockDialogClose}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Stock from Excel</DialogTitle>
            <DialogDescription>
              Upload an Excel file with Item_barcode, quantity, rate, value columns
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Button variant="outline" onClick={downloadStockTemplate} size="sm" data-testid="button-download-stock-template">
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
            <div className="space-y-2">
              <Label htmlFor="stock-file">Select Excel File</Label>
              <Input
                id="stock-file"
                type="file"
                accept=".xlsx,.xls"
                onChange={handleStockFileChange}
                disabled={isImportingStock || stockImportComplete}
                data-testid="input-stock-file"
              />
              {stockFile && <p className="text-sm text-muted-foreground">Selected: {stockFile.name}</p>}
            </div>
            {stockErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <div className="font-semibold mb-2">{stockErrors.length} validation error(s):</div>
                  <ul className="list-disc list-inside space-y-1">
                    {stockErrors.slice(0, 5).map((err, i) => <li key={i} className="text-sm">{err}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {stockPreview.length > 0 && stockErrors.length === 0 && (
              <Alert>
                <Package className="h-4 w-4" />
                <AlertDescription>{stockPreview.length} records ready to import</AlertDescription>
              </Alert>
            )}
            {stockImportComplete && (
              <Alert>
                <Package className="h-4 w-4" />
                <AlertDescription>Stock imported successfully</AlertDescription>
              </Alert>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={handleStockDialogClose} disabled={isImportingStock}>Close</Button>
              <Button
                onClick={handleStockImport}
                disabled={stockPreview.length === 0 || stockErrors.length > 0 || isImportingStock || stockImportComplete}
                data-testid="button-submit-stock-import"
              >
                {isImportingStock ? "Importing..." : "Import Stock"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Merge Stock Items Card ────────────────────────────────────────────────────

interface MergePreviewResult {
  keptItem:      { id: number; code: string; name: string; uom: string };
  duplicateItem: { id: number; code: string; name: string; uom: string };
  uomMismatch: boolean;
  inventoryImpact: Array<{
    locationId: number;
    locationName: string;
    keptQty: number;   keptValue: number;   keptRate: number;
    dupQty: number;    dupValue: number;    dupRate: number;
    combinedQty: number; combinedValue: number; combinedRate: number;
    action: "combine" | "reassign" | "no_change";
  }>;
  totalValueBefore: number;
  totalValueAfter:  number;
  warnings: string[];
}

function MergeStockItemsCard() {
  const { toast } = useToast();
  const [keptItem, setKeptItem] = useState<{ id: number; name: string } | null>(null);
  const [dupItem,  setDupItem]  = useState<{ id: number; name: string } | null>(null);
  const [preview,  setPreview]  = useState<MergePreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isMerging,   setIsMerging]   = useState(false);

  const { data: allStockItems = [] } = useQuery<{ id: number; name: string; code: string }[]>({
    queryKey: ["/api/stock-items"],
  });

  async function handlePreview() {
    if (!keptItem || !dupItem) return;
    setPreview(null);
    setPreviewError(null);
    setConfirmText("");
    setIsLoadingPreview(true);
    try {
      const res = await fetch(`/api/stock-items/${keptItem.id}/merge-preview?duplicateId=${dupItem.id}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Preview failed");
      setPreview(data);
    } catch (err: any) {
      setPreviewError(err.message);
    } finally {
      setIsLoadingPreview(false);
    }
  }

  async function handleMerge() {
    if (!keptItem || !dupItem || confirmText !== "MERGE") return;
    setIsMerging(true);
    try {
      const res = await apiRequest("POST", `/api/stock-items/${keptItem.id}/merge`, {
        duplicateId: dupItem.id,
        confirm: "MERGE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Merge failed");
      }
      toast({ title: "Merge complete", description: `"${dupItem.name}" has been merged into "${keptItem.name}".` });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/location-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/net-profit"] });
      setKeptItem(null);
      setDupItem(null);
      setPreview(null);
      setConfirmText("");
      setPreviewError(null);
    } catch (err: any) {
      toast({ title: "Merge failed", description: err.message, variant: "destructive" });
    } finally {
      setIsMerging(false);
    }
  }

  return (
    <Card className="col-span-1 md:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4" />
          Merge Duplicate Stock Items
        </CardTitle>
        <CardDescription>
          Combine two stock items into one. Inventory quantities and values are preserved exactly to the cent. Historical transaction rows are not rewritten in this phase.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Item to keep</Label>
            <StockItemAutocomplete
              value={keptItem}
              onChange={(id, name) => { setKeptItem({ id, name }); setPreview(null); setPreviewError(null); setConfirmText(""); }}
              stockItems={allStockItems}
              placeholder="Search item to keep..."
              testId="merge-keep-item"
            />
          </div>
          <div className="space-y-2">
            <Label>Duplicate to merge away</Label>
            <StockItemAutocomplete
              value={dupItem}
              onChange={(id, name) => { setDupItem({ id, name }); setPreview(null); setPreviewError(null); setConfirmText(""); }}
              stockItems={allStockItems}
              placeholder="Search duplicate item..."
              testId="merge-dup-item"
            />
          </div>
        </div>

        <Button
          variant="outline"
          onClick={handlePreview}
          disabled={!keptItem || !dupItem || isLoadingPreview}
          data-testid="button-merge-preview"
        >
          {isLoadingPreview
            ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            : <Eye className="h-4 w-4 mr-2" />}
          Preview Merge
        </Button>

        {previewError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{previewError}</AlertDescription>
          </Alert>
        )}

        {preview && (
          <div className="space-y-3">
            {preview.uomMismatch && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  UOM mismatch — kept item is <strong>{preview.keptItem.uom}</strong>, duplicate is <strong>{preview.duplicateItem.uom}</strong>. This merge is blocked in Phase 1.
                </AlertDescription>
              </Alert>
            )}
            {preview.warnings.map((w, i) => (
              <Alert key={i}>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{w}</AlertDescription>
              </Alert>
            ))}

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Keep Qty</TableHead>
                    <TableHead className="text-right">Dup Qty</TableHead>
                    <TableHead className="text-right">Combined Qty</TableHead>
                    <TableHead className="text-right">Combined Rate</TableHead>
                    <TableHead className="text-right">Combined Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.inventoryImpact.map((row) => (
                    <TableRow key={row.locationId} data-testid={`row-merge-impact-${row.locationId}`}>
                      <TableCell>{row.locationName}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(row.keptQty, 3)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(row.dupQty, 3)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{formatNumber(row.combinedQty, 3)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(row.combinedRate, 2)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(row.combinedValue, 2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              <span>Total value before: <strong className="text-foreground tabular-nums">{formatNumber(preview.totalValueBefore, 2)}</strong></span>
              <span>Total value after: <strong className="text-foreground tabular-nums">{formatNumber(preview.totalValueAfter, 2)}</strong></span>
            </div>

            {!preview.uomMismatch && (
              <div className="space-y-2 border-t pt-3">
                <p className="text-sm text-muted-foreground">
                  This action cannot be undone. Type <strong>MERGE</strong> to confirm.
                </p>
                <div className="flex gap-2 items-center flex-wrap">
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="Type MERGE"
                    className="max-w-[160px]"
                    data-testid="input-merge-confirm"
                  />
                  <Button
                    onClick={handleMerge}
                    disabled={confirmText !== "MERGE" || isMerging}
                    data-testid="button-confirm-merge"
                  >
                    {isMerging && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Confirm Merge
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Bulk Merge Stock Items Card ───────────────────────────────────────────────

type BulkMergePairRow = {
  oldCode: string;
  keepCode: string;
};

type BulkMergeResult = {
  oldCode: string;
  keepCode: string;
  status: "success" | "skipped" | "error";
  reason?: string;
  keptItemName?: string;
  oldItemName?: string;
};

function BulkMergeStockItemsCard() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsedRows, setParsedRows] = useState<BulkMergePairRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [results, setResults] = useState<BulkMergeResult[] | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  async function downloadTemplate() {
    const wb = utils.book_new();
    const ws = utils.aoa_to_sheet([
      ["old_code", "keep_code"],
      ["ITEM-OLD-001", "ITEM-KEEP-001"],
    ]);
    (ws as any)["!cols"] = [{ wch: 24 }, { wch: 24 }];
    utils.book_append_sheet(wb, ws, "Merge Pairs");
    await writeFile(wb, "bulk_merge_template.xlsx");
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParsedRows([]);
    setParseError(null);
    setResults(null);
    try {
      const wb = await readFile(file);
      const ws = wb.worksheets[0];
      if (!ws) throw new Error("No worksheet found in file");
      const rows = utils.sheet_to_json<{ old_code?: any; keep_code?: any }>(ws);
      const parsed: BulkMergePairRow[] = [];
      for (const row of rows) {
        const oldCode  = String(row.old_code  ?? row.Old_Code  ?? row.OLD_CODE  ?? "").trim();
        const keepCode = String(row.keep_code ?? row.Keep_Code ?? row.KEEP_CODE ?? "").trim();
        if (oldCode && keepCode) parsed.push({ oldCode, keepCode });
      }
      if (parsed.length === 0) throw new Error("No valid rows found. Check that the file has old_code and keep_code columns.");
      setParsedRows(parsed);
    } catch (err: any) {
      setParseError(err.message);
    }
  }

  async function handleRun() {
    if (parsedRows.length === 0) return;
    setIsRunning(true);
    setResults(null);
    try {
      const res = await apiRequest("POST", "/api/stock-items/bulk-merge", { pairs: parsedRows });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Bulk merge failed");
      setResults(data.results ?? []);
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      const succeeded = (data.results as BulkMergeResult[]).filter(r => r.status === "success").length;
      toast({ title: `Bulk merge done — ${succeeded} of ${data.results.length} merged` });
    } catch (err: any) {
      toast({ title: "Bulk merge failed", description: err.message, variant: "destructive" });
    } finally {
      setIsRunning(false);
    }
  }

  function reset() {
    setParsedRows([]);
    setParseError(null);
    setFileName(null);
    setResults(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const succeeded = results?.filter(r => r.status === "success").length ?? 0;
  const skipped   = results?.filter(r => r.status === "skipped").length ?? 0;
  const errored   = results?.filter(r => r.status === "error").length ?? 0;

  return (
    <Card className="col-span-1 md:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          Bulk Merge via Excel
        </CardTitle>
        <CardDescription>
          Upload a two-column Excel file (old_code → keep_code) to merge many duplicate items at once. Each pair runs the same safe merge logic as the single-item merge above.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={downloadTemplate} data-testid="button-bulk-merge-template">
            <FileDown className="h-4 w-4 mr-2" />
            Download Template
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} data-testid="button-bulk-merge-upload">
            <Upload className="h-4 w-4 mr-2" />
            Upload Excel File
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
            data-testid="input-bulk-merge-file"
          />
        </div>

        {fileName && <p className="text-sm text-muted-foreground">File: {fileName}</p>}

        {parseError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{parseError}</AlertDescription>
          </Alert>
        )}

        {parsedRows.length > 0 && !results && (
          <div className="space-y-3">
            <p className="text-sm font-medium">{parsedRows.length} pair{parsedRows.length !== 1 ? "s" : ""} ready to merge</p>
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Old code (to remove)</TableHead>
                    <TableHead>Keep code</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedRows.slice(0, 20).map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                      <TableCell className="font-mono text-sm">{row.oldCode}</TableCell>
                      <TableCell className="font-mono text-sm">{row.keepCode}</TableCell>
                    </TableRow>
                  ))}
                  {parsedRows.length > 20 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                        …and {parsedRows.length - 20} more rows
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleRun} disabled={isRunning} data-testid="button-bulk-merge-run">
                {isRunning && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isRunning ? "Merging…" : `Merge ${parsedRows.length} pair${parsedRows.length !== 1 ? "s" : ""}`}
              </Button>
              <Button variant="outline" onClick={reset} disabled={isRunning} data-testid="button-bulk-merge-reset">
                Clear
              </Button>
            </div>
          </div>
        )}

        {results && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-green-600" />
                <span><strong>{succeeded}</strong> merged</span>
              </span>
              <span className="flex items-center gap-1.5">
                <X className="h-4 w-4 text-yellow-600" />
                <span><strong>{skipped}</strong> skipped</span>
              </span>
              {errored > 0 && (
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <span><strong>{errored}</strong> error{errored !== 1 ? "s" : ""}</span>
                </span>
              )}
            </div>

            {(skipped > 0 || errored > 0) && (
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Old code</TableHead>
                      <TableHead>Keep code</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.filter(r => r.status !== "success").map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-sm">{r.oldCode}</TableCell>
                        <TableCell className="font-mono text-sm">{r.keepCode}</TableCell>
                        <TableCell>
                          <Badge variant={r.status === "error" ? "destructive" : "secondary"}>
                            {r.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.reason ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <Button variant="outline" size="sm" onClick={reset} data-testid="button-bulk-merge-done">
              Start another batch
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Merge History / Unmerge Card ─────────────────────────────────────────────

interface MergeLogEntry {
  id: number | null;
  keptItemId: number;
  keptItemCode: string;
  keptItemName: string;
  mergedItemId: number;
  mergedItemCode: string;
  mergedItemName: string;
  mergedAt: string;
  notes: string | null;
  source?: "historical";
}

function MergeHistoryCard() {
  const { toast } = useToast();
  const [unmergeTarget, setUnmergeTarget] = useState<MergeLogEntry | null>(null);
  const [isUnmerging, setIsUnmerging] = useState(false);

  const { data: logs = [], isLoading } = useQuery<MergeLogEntry[]>({
    queryKey: ["/api/stock-items/merge-logs"],
  });

  const { data: historicalLogs = [], isLoading: historicalLoading } = useQuery<MergeLogEntry[]>({
    queryKey: ["/api/stock-items/merge-logs/historical"],
  });

  const allLogs = [...logs, ...historicalLogs].sort(
    (a, b) => new Date(b.mergedAt).getTime() - new Date(a.mergedAt).getTime()
  );

  async function handleUnmerge() {
    if (!unmergeTarget) return;
    setIsUnmerging(true);
    try {
      const res = await apiRequest("POST", `/api/stock-items/merge-logs/${unmergeTarget.id}/unmerge`, {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Unmerge failed");
      toast({ title: "Unmerge complete", description: data.message });
      setUnmergeTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items/merge-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
    } catch (err: any) {
      toast({ title: "Unmerge failed", description: err.message, variant: "destructive" });
    } finally {
      setIsUnmerging(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RotateCcw className="h-4 w-4" />
          Merge History
        </CardTitle>
        <CardDescription>
          View recent item merges and reverse them if needed. Inventory quantities and values are restored exactly from the pre-merge snapshot. Location prices deleted during merge cannot be recovered.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading || historicalLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : allLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No merges recorded for this company yet.</p>
        ) : (
          <>
            {historicalLogs.length > 0 && logs.length === 0 && (
              <p className="text-xs text-muted-foreground mb-3">
                These merges were done before history tracking was added. They were reconstructed from alias records — no snapshot is available so they cannot be unmerged automatically.
              </p>
            )}
            {historicalLogs.length > 0 && logs.length > 0 && (
              <p className="text-xs text-muted-foreground mb-3">
                Entries marked <span className="font-medium">Historical</span> were done before history tracking was added and cannot be unmerged automatically.
              </p>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kept item</TableHead>
                  <TableHead>Merged away</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-32"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allLogs.map((log, idx) => (
                  <TableRow key={log.id ?? `hist-${idx}`} data-testid={`row-merge-log-${log.id ?? idx}`}>
                    <TableCell>
                      <p className="font-medium text-sm">{log.keptItemName}</p>
                      <p className="text-xs text-muted-foreground">{log.keptItemCode}</p>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium text-sm">{log.mergedItemName}</p>
                      <p className="text-xs text-muted-foreground">{log.mergedItemCode}</p>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(log.mergedAt).toLocaleDateString()}
                      {log.source === "historical" && (
                        <Badge variant="outline" className="ml-2 text-[10px]">Historical</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {log.source === "historical" ? (
                        <span className="text-xs text-muted-foreground">No snapshot</span>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setUnmergeTarget(log)}
                          data-testid={`button-unmerge-${log.id}`}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          Unmerge
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>

      {/* Unmerge confirmation dialog */}
      <AlertDialog open={!!unmergeTarget} onOpenChange={(open) => { if (!open) setUnmergeTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unmerge this item?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This will restore <strong>{unmergeTarget?.mergedItemName}</strong> as a separate active item and revert inventory quantities back to the pre-merge state.
                </p>
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Any selling prices that were deleted during the merge (because the kept item already had a price for that location) cannot be recovered automatically. You may need to re-enter them manually.
                  </AlertDescription>
                </Alert>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUnmerging} data-testid="button-unmerge-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnmerge}
              disabled={isUnmerging}
              data-testid="button-unmerge-confirm"
            >
              {isUnmerging ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Unmerging…</> : "Yes, unmerge it"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ── Edit Log helpers ──────────────────────────────────────────────────────────

