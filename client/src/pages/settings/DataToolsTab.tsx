import { getErrorDetails } from "@shared/errorUtils";
import { useState, useRef } from "react";
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
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import {
  Plus,
  Edit,
  RefreshCw,
  Calculator,
  Loader2,
  AlertTriangle,
  Package,
  Upload,
  Download,
  Database,
  TrendingUp,
  TrendingDown,
  Check,
  X,
  ArrowLeftRight,
  CheckCircle2,
  FileSpreadsheet,
  FileDown,
  Search,
} from "lucide-react";
import { utils, writeFile, readFile, read } from "@/lib/excelHelper";
import { Link } from "wouter";
import { BulkRenameTab } from "./BulkRenameTab";
import { useCompany } from "@/contexts/CompanyContext";
import { formatNumber } from "@/lib/formatNumber";
import type { SilentImportRow } from "./datatoolstab/types";
import { ReconcileOTWNamesCard } from "./datatoolstab/components/ReconcileOTWNamesCard";
import { MergeStockItemsLauncher } from "./datatoolstab/components/MergeStockItemsLauncher";
export function DataToolsTab() {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  // Separate location selection for each import operation
  const [costPriceLocationId, _setCostPriceLocationId] = useState<string>("");
  const [stockLocationId, setStockLocationId] = useState<string>("");
  // Cost price import state
  const [_costPriceImportOpen, setCostPriceImportOpen] = useState(false);
  const [_costPriceFile, setCostPriceFile] = useState<File | null>(null);
  const [costPricePreview, setCostPricePreview] = useState<Array<{ barcode: string; costPrice: number }>>([]);
  const [costPriceErrors, setCostPriceErrors] = useState<string[]>([]);
  const [_isImportingCostPrice, setIsImportingCostPrice] = useState(false);
  const [_costPriceImportComplete, setCostPriceImportComplete] = useState(false);
  // Stock import state
  const [stockImportOpen, setStockImportOpen] = useState(false);
  const [stockFile, setStockFile] = useState<File | null>(null);
  const [stockPreview, setStockPreview] = useState<
    Array<{ Item_barcode: string; stockGroupCode?: string; quantity: string; rate: string; value: string }>
  >([]);
  const [stockErrors, setStockErrors] = useState<string[]>([]);
  const [isImportingStock, setIsImportingStock] = useState(false);
  const [stockImportComplete, setStockImportComplete] = useState(false);
  // Current user (for developer-only features)
  const { data: dtCurrentUser } = useQuery<{ role?: string }>({ queryKey: ["/api/auth/me"] });
  // Silent production / consumption state
  const [silentProdOpen, setSilentProdOpen] = useState(false);
  const [silentProdType, setSilentProdType] = useState<"Production" | "Consumption">("Production");
  const [silentProdLocId, setSilentProdLocId] = useState("");
  const [silentProdItems, setSilentProdItems] = useState<
    { stockItemId: string; stockItemName: string; quantity: string; rate: string; currentQty: number }[]
  >([{ stockItemId: "", stockItemName: "", quantity: "", rate: "", currentQty: 0 }]);
  const [silentProdSearchTerm, setSilentProdSearchTerm] = useState("");
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
  const [silentValidItems, setSilentValidItems] = useState<unknown[]>([]);
  const [silentWarnItems, setSilentWarnItems] = useState<unknown[]>([]);
  const [silentErrorLines, setSilentErrorLines] = useState<unknown[]>([]);
  const [silentIncludeWarnings, setSilentIncludeWarnings] = useState(false);
  const [silentParseError, setSilentParseError] = useState("");
  const [silentStep, setSilentStep] = useState<"setup" | "validation" | "done">("setup");
  const [isSilentParsing, setIsSilentParsing] = useState(false);
  const [isSilentApplying, setIsSilentApplying] = useState(false);
  const [silentAppliedCount, setSilentAppliedCount] = useState(0);
  // Bulk rename dialog state
  const [bulkRenameOpen, setBulkRenameOpen] = useState(false);
  // Fetch locations for the current company
  const { data: locations = [] } = useQuery<unknown[]>({
    queryKey: ["/api/locations", selectedCompany?.id],
    enabled: !!selectedCompany,
  });
  // Fetch stock items for silent production picker (developer-only, lightweight)
  const { data: allStockItems = [] } = useQuery<unknown[]>({
    queryKey: ["/api/stock-items/light", selectedCompany?.id],
    enabled: !!selectedCompany && dtCurrentUser?.role === "Developer",
    staleTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  // Fetch location inventory for silent prod (manual + import modes)
  const { data: silentLocInventory = [], isLoading: silentLocInventoryLoading } = useQuery<
    {
      stockItemId: number;
      stockItemName: string;
      stockItemCode: string;
      quantity: string;
    }[]
  >({
    queryKey: ["/api/inventory-by-location", silentProdLocId],
    queryFn: async () => {
      if (!silentProdLocId) return [];
      const res = await fetch(`/api/inventory-by-location/${silentProdLocId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!silentProdLocId && silentProdOpen,
  });
  // Fix Cost Prices mutation
  const recalculateCostsMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/sales-report/recalculate-costs", {});
    },
    onSuccess: (data: unknown) => {
      toast({
        title: "Cost Prices Updated",
        description: `Updated ${data.updatedCount} of ${data.totalChecked} sales items`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-report"] });
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  // Cost price import functions
  const _downloadCostPriceTemplate = async () => {
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
  const _handleCostPriceFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
      const jsonData = utils.sheet_to_json<unknown>(worksheet);
      if (jsonData.length === 0) {
        toast({ title: "Empty File", description: "The Excel file is empty.", variant: "destructive" });
        return;
      }
      const headerRow = utils.sheet_to_json<string[]>(worksheet, { header: 1 })[0] || [];
      const columns = headerRow.map((h: unknown) => String(h || "").trim());
      const requiredCols = ["barcode", "costPrice"];
      const missingCols = requiredCols.filter((col) => !columns.includes(col));
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
      jsonData.forEach((row: unknown, index: number) => {
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
    } catch (_error) {
      toast({ title: "Error Reading File", description: "Please ensure valid Excel file.", variant: "destructive" });
    }
  };
  const _handleCostPriceImport = async () => {
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
    } catch (error) {
      toast({
        title: "Import Failed",
        description: getErrorDetails(error).message || "Failed to import",
        variant: "destructive",
      });
    } finally {
      setIsImportingCostPrice(false);
    }
  };
  const _handleCostPriceDialogClose = async () => {
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
      const jsonData = utils.sheet_to_json<unknown>(worksheet);
      if (jsonData.length === 0) {
        toast({ title: "Empty File", description: "The Excel file is empty.", variant: "destructive" });
        return;
      }
      const headerRow = utils.sheet_to_json<string[]>(worksheet, { header: 1 })[0] || [];
      const columns = headerRow.map((h: unknown) => String(h || "").trim());
      const requiredCols = ["Item_barcode", "quantity", "rate", "value"];
      const missingCols = requiredCols.filter((col) => !columns.includes(col));
      if (missingCols.length > 0) {
        toast({
          title: "Missing Required Columns",
          description: `Expected: ${requiredCols.join(", ")}. Download template for format.`,
          variant: "destructive",
        });
        return;
      }
      const errors: string[] = [];
      const rows: Array<{
        Item_barcode: string;
        stockGroupCode?: string;
        quantity: string;
        rate: string;
        value: string;
      }> = [];
      jsonData.forEach((row: unknown, index: number) => {
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
    } catch (_error) {
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
    } catch (error) {
      toast({
        title: "Import Failed",
        description: getErrorDetails(error).message || "Failed to import",
        variant: "destructive",
      });
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
    const locRow = silentLocInventory.find((inv: unknown) => inv.stockItemId === stockItemId);
    return locRow ? parseFloat(locRow.quantity || "0") : 0;
  };

  const handleSilentImportFile = async (file: File) => {
    setSilentImportLoading(true);
    try {
      const wb = await readFile(file);
      const ws = wb.getWorksheet(1);
      if (!ws) {
        toast({ title: "Error", description: "Could not read worksheet", variant: "destructive" });
        return;
      }
      const rows = utils.sheet_to_json<{
        Code?: unknown;
        Name?: unknown;
        "Qty Change"?: unknown;
        "Item Name"?: unknown;
        Change?: unknown;
        Rate?: unknown;
      }>(ws);

      const preview: SilentImportRow[] = rows
        .filter((row) => row.Code !== undefined || row.Name !== undefined || row["Item Name"] !== undefined)
        .map((row) => {
          const code = String(row.Code ?? "").trim();
          const name = String(row.Name ?? row["Item Name"] ?? "").trim();
          const change = parseFloat(String(row["Qty Change"] ?? row.Change ?? "0")) || 0;
          const rate = parseFloat(String(row.Rate ?? "0")) || 0;

          let matched: unknown = code
            ? (allStockItems as unknown[]).find((s: unknown) => s.code?.toLowerCase() === code.toLowerCase())
            : undefined;
          if (!matched && name)
            matched = (allStockItems as unknown[]).find((s: unknown) => s.name.toLowerCase() === name.toLowerCase());

          if (!matched) {
            return {
              rawCode: code,
              rawName: name,
              stockItemId: null,
              stockItemName: name || code || "Unknown",
              currentQty: 0,
              change,
              newQty: Math.max(0, change),
              rate,
              status: "not_found" as const,
            };
          }

          const currentQty = getCurrentQty(matched.id);
          const newQty = currentQty + change;
          const status: SilentImportRow["status"] = newQty <= 0 ? "to_zero" : "ok";
          return {
            rawCode: code,
            rawName: name,
            stockItemId: matched.id,
            stockItemName: matched.name,
            currentQty,
            change,
            newQty: Math.max(0, newQty),
            rate,
            status,
          };
        });

      setSilentImportPreview(preview);
    } catch (err) {
      toast({
        title: "Parse Error",
        description: getErrorDetails(err).message || "Failed to read file",
        variant: "destructive",
      });
    } finally {
      setSilentImportLoading(false);
    }
  };

  const exportSilentExcel = async () => {
    const wb = utils.book_new();
    const ws = wb.addWorksheet("Adjustment");
    ws.addRow(["Item Name", "Qty"]);
    ws.getRow(1).font = { bold: true };
    for (const row of silentImportPreview.filter((r) => r.status !== "not_found")) {
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
    doc.text(
      `Location: ${(locations as unknown[]).find((l: unknown) => String(l.id) === silentProdLocId)?.name || ""}   Date: ${new Date().toLocaleDateString()}`,
      14,
      25
    );
    const rows = silentImportPreview
      .filter((r) => r.status !== "not_found")
      .map((r, i) => [i + 1, r.stockItemName, r.newQty]);
    autoTable(doc, {
      startY: 30,
      head: [["#", "Item Name", "New Qty"]],
      body: rows,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [30, 30, 30] },
      columnStyles: { 0: { cellWidth: 12 }, 2: { cellWidth: 22, halign: "right" } },
    });
    doc.save("silent_adjustment_preview.pdf");
  };

  const applySilentImport = async () => {
    const valid = silentImportPreview.filter((r) => r.stockItemId !== null && r.status !== "not_found");
    const productions = valid.filter((r) => r.change > 0);
    const consumptions = valid.filter((r) => r.change < 0);
    if (valid.length === 0) return;
    setSilentProdApplying(true);
    try {
      let totalApplied = 0;
      if (productions.length > 0) {
        const res = await apiRequest("POST", "/api/inventory/silent-production", {
          locationId: silentProdLocId,
          type: "Production",
          items: productions.map((r) => ({
            stockItemId: String(r.stockItemId),
            quantity: String(Math.abs(r.change)),
            rate: String(r.rate),
          })),
        });
        const d = await res.json();
        totalApplied += d.applied || productions.length;
      }
      if (consumptions.length > 0) {
        const res = await apiRequest("POST", "/api/inventory/silent-production", {
          locationId: silentProdLocId,
          type: "Consumption",
          items: consumptions.map((r) => ({
            stockItemId: String(r.stockItemId),
            quantity: String(Math.abs(r.change)),
            rate: "0",
          })),
        });
        const d = await res.json();
        totalApplied += d.applied || consumptions.length;
      }
      setSilentProdDone(totalApplied);
      setSilentImportPreview([]);
      setSilentImportMode(false);
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-by-location"] });
      queryClient.invalidateQueries({ queryKey: ["/api/location-summary"] });
    } catch (err) {
      toast({ title: "Error", description: getErrorDetails(err).message, variant: "destructive" });
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
        <p className="text-muted-foreground">Please select a company to access data tools.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Database className="h-5 w-5" />
        <h2 className="text-2xl font-semibold">Data Tools</h2>
      </div>
      <p className="text-muted-foreground">Administrative utilities for bulk data operations and maintenance tasks.</p>

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
        {/* Import Stock Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Import Stock
            </CardTitle>
            <CardDescription>Bulk import inventory quantities from Excel file</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Select Location</Label>
              <Select value={stockLocationId} onValueChange={setStockLocationId}>
                <SelectTrigger data-testid="select-location-stock-import">
                  <SelectValue placeholder="Choose location..." />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc: unknown) => (
                    <SelectItem key={loc.id} value={String(loc.id)}>
                      {loc.name}
                    </SelectItem>
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

        {/* Fix Cost Prices Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Fix Cost Prices
            </CardTitle>
            <CardDescription>Recalculate sales cost prices based on inventory records</CardDescription>
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
            <CardDescription>Move stock between locations via Excel upload — no daybook entry created</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setSilentStep("setup");
                setSilentValidItems([]);
                setSilentWarnItems([]);
                setSilentErrorLines([]);
                setSilentParseError("");
                setSilentFile(null);
                setSilentAppliedCount(0);
                setSilentTransferOpen(true);
              }}
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
                onClick={() => {
                  setSilentProdType("Production");
                  setSilentProdLocId("");
                  setSilentProdItems([{ stockItemId: "", stockItemName: "", quantity: "", rate: "", currentQty: 0 }]);
                  setSilentProdSearchTerm("");
                  setSilentProdDone(0);
                  setSilentImportMode(false);
                  setSilentImportPreview([]);
                  setSilentProdOpen(true);
                }}
                data-testid="button-open-silent-production"
              >
                <Package className="h-4 w-4 mr-2" />
                Open Silent Production / Consumption
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Bulk Rename Stock Items — Admin/Owner/Developer */}
        {appMode !== "factory" &&
          ["Admin", "Owner", "Developer"].includes(dtCurrentUser?.role || "") &&
          selectedCompany && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Edit className="h-4 w-4" />
                  Bulk Rename Stock Items
                </CardTitle>
                <CardDescription className="text-xs">
                  Find and replace text across multiple stock item names at once.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setBulkRenameOpen(true)}
                  data-testid="button-open-bulk-rename"
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Open Bulk Rename
                </Button>
              </CardContent>
            </Card>
          )}

        {/* Merge Stock Items — Single card, dialog with tabs */}
        {appMode !== "factory" &&
          ["Admin", "Owner", "Developer"].includes(dtCurrentUser?.role || "") &&
          selectedCompany && <MergeStockItemsLauncher />}

        {/* Reconcile OTW Names */}
        {appMode !== "factory" &&
          ["Admin", "Owner", "Developer"].includes(dtCurrentUser?.role || "") &&
          selectedCompany && <ReconcileOTWNamesCard />}

        {/* Merge Bale Products — factory mode, Admin/Owner/Developer */}
        {appMode === "factory" && ["Admin", "Owner", "Developer"].includes(dtCurrentUser?.role || "") && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowLeftRight className="h-4 w-4" />
                Merge Bale Products
              </CardTitle>
              <CardDescription>
                Combine duplicate bale product entries — all bales from the selected items move to the one you keep, and
                the duplicates are deactivated
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
        <Dialog
          open={silentProdOpen}
          onOpenChange={(o) => {
            if (!silentProdApplying) {
              if (!o) setSilentProdSearchTerm("");
              setSilentProdOpen(o);
            }
          }}
        >
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
                <Button
                  variant="outline"
                  onClick={() => setSilentProdOpen(false)}
                  data-testid="button-silent-prod-close"
                >
                  Close
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Mode toggle */}
                <div className="flex gap-2 border-b pb-3">
                  <Button
                    variant={!silentImportMode ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setSilentImportMode(false);
                      setSilentImportPreview([]);
                    }}
                    data-testid="button-mode-manual"
                  >
                    Manual Entry
                  </Button>
                  <Button
                    variant={silentImportMode ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setSilentImportMode(true);
                    }}
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
                      {(locations as unknown[]).map((loc: unknown) => (
                        <SelectItem key={loc.id} value={String(loc.id)}>
                          {loc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {!silentImportMode ? (
                  <>
                    {/* Type toggle — manual mode only */}
                    <div className="flex gap-2">
                      <Button
                        variant={silentProdType === "Production" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSilentProdType("Production")}
                        data-testid="button-type-production"
                      >
                        Production (+)
                      </Button>
                      <Button
                        variant={silentProdType === "Consumption" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSilentProdType("Consumption")}
                        data-testid="button-type-consumption"
                      >
                        Consumption (−)
                      </Button>
                    </div>

                    {/* Items table — stock-transfer style with search */}
                    <div className="space-y-2">
                      <Label>Items</Label>

                      {/* Searchable sidebar panel */}
                      {silentProdLocId && (
                        <div className="border rounded-md p-3 bg-muted/30 space-y-2">
                          <div className="relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              placeholder="Type item name or code to search…"
                              value={silentProdSearchTerm}
                              onChange={(e) => {
                                setSilentProdSearchTerm(e.target.value);
                              }}
                              className="pl-8"
                              data-testid="input-silent-prod-search"
                            />
                          </div>
                          <div className="max-h-48 overflow-y-auto space-y-1">
                            {(() => {
                              const term = silentProdSearchTerm.toLowerCase();
                              if (!term) {
                                return (
                                  <div className="text-center text-sm text-muted-foreground py-4">
                                    {silentLocInventoryLoading
                                      ? "Loading items…"
                                      : "Type above to search items at this location"}
                                  </div>
                                );
                              }
                              const filtered = (allStockItems as unknown[]).filter(
                                (si: unknown) =>
                                  si.name.toLowerCase().includes(term) ||
                                  (si.code && si.code.toLowerCase().includes(term))
                              );
                              if (filtered.length === 0)
                                return (
                                  <div className="text-center text-sm text-muted-foreground py-4">No items found</div>
                                );
                              return filtered.map((si: unknown) => {
                                const locRow = silentLocInventory.find((inv: unknown) => inv.stockItemId === si.id);
                                const currentQty = locRow ? parseFloat(locRow.quantity || "0") : 0;
                                return (
                                  <button
                                    key={si.id}
                                    className="w-full text-left px-2 py-1.5 rounded-md hover-elevate active-elevate-2 flex items-center justify-between gap-2"
                                    onClick={() => {
                                      // Add to rows if not already present
                                      const existingIdx = silentProdItems.findIndex(
                                        (r) => String(r.stockItemId) === String(si.id)
                                      );
                                      if (existingIdx < 0) {
                                        setSilentProdItems((prev) => [
                                          ...prev,
                                          {
                                            stockItemId: String(si.id),
                                            stockItemName: si.name,
                                            quantity: "",
                                            rate: "",
                                            currentQty,
                                          },
                                        ]);
                                      }
                                      setSilentProdSearchTerm("");
                                    }}
                                    data-testid={`button-silent-prod-search-item-${si.id}`}
                                  >
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm font-medium truncate">{si.name}</div>
                                      {si.code && (
                                        <div className="text-xs text-muted-foreground font-mono">{si.code}</div>
                                      )}
                                    </div>
                                    <div
                                      className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                                        currentQty === 0
                                          ? "bg-destructive/10 text-destructive"
                                          : currentQty < 10
                                            ? "bg-chart-3/10 text-chart-3"
                                            : "bg-chart-2/10 text-chart-2"
                                      }`}
                                    >
                                      {currentQty.toFixed(0)}
                                    </div>
                                  </button>
                                );
                              });
                            })()}
                          </div>
                        </div>
                      )}

                      <div className="space-y-2">
                        {silentProdItems.map((item, idx) => {
                          const qtyNum = parseFloat(item.quantity || "0") || 0;
                          const delta = silentProdType === "Production" ? qtyNum : -qtyNum;
                          const newQty = (item.currentQty || 0) + delta;
                          return (
                            <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                              <div className="col-span-5">
                                <Input
                                  readOnly
                                  value={item.stockItemName || "Search above and click an item"}
                                  placeholder="Search above and click an item"
                                  className="w-full"
                                  data-testid={`input-silent-prod-item-${idx}`}
                                  onClick={() => {}}
                                />
                              </div>
                              <div className="col-span-2">
                                <div
                                  className="text-right text-sm text-muted-foreground font-mono"
                                  data-testid={`text-current-qty-${idx}`}
                                >
                                  {item.stockItemId ? (item.currentQty || 0).toFixed(0) : "-"}
                                </div>
                                <div className="text-right text-xs text-muted-foreground">Current</div>
                              </div>
                              <div className="col-span-2">
                                <Input
                                  type="number"
                                  min="0.001"
                                  step="0.001"
                                  placeholder={silentProdType === "Production" ? "+Qty" : "−Qty"}
                                  value={item.quantity}
                                  onChange={(e) =>
                                    setSilentProdItems((prev) =>
                                      prev.map((r, i) => (i === idx ? { ...r, quantity: e.target.value } : r))
                                    )
                                  }
                                  data-testid={`input-silent-prod-qty-${idx}`}
                                  className="text-right"
                                />
                              </div>
                              <div className="col-span-2">
                                <div
                                  className={`text-right text-sm font-mono font-semibold ${
                                    newQty < 0 ? "text-destructive" : "text-foreground"
                                  }`}
                                  data-testid={`text-new-qty-${idx}`}
                                >
                                  {item.stockItemId && item.quantity ? newQty.toFixed(0) : "-"}
                                </div>
                                <div className="text-right text-xs text-muted-foreground">New</div>
                              </div>
                              <div className="col-span-1 flex justify-center">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => setSilentProdItems((prev) => prev.filter((_, i) => i !== idx))}
                                  disabled={silentProdItems.length === 1}
                                  data-testid={`button-remove-prod-row-${idx}`}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Rate input shown for Production only */}
                      {silentProdType === "Production" && silentProdItems.some((r) => r.stockItemId) && (
                        <div className="space-y-1">
                          {silentProdItems.map(
                            (item, idx) =>
                              item.stockItemId && (
                                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                                  <div
                                    className="col-span-5 text-sm text-muted-foreground truncate"
                                    data-testid={`text-rate-item-${idx}`}
                                  >
                                    {item.stockItemName}
                                  </div>
                                  <div className="col-span-3 col-start-6">
                                    <Input
                                      type="number"
                                      placeholder="Rate"
                                      value={item.rate}
                                      onChange={(e) =>
                                        setSilentProdItems((prev) =>
                                          prev.map((r, i) => (i === idx ? { ...r, rate: e.target.value } : r))
                                        )
                                      }
                                      data-testid={`input-silent-prod-rate-${idx}`}
                                    />
                                  </div>
                                </div>
                              )
                          )}
                        </div>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setSilentProdItems((prev) => [
                            ...prev,
                            { stockItemId: "", stockItemName: "", quantity: "", rate: "", currentQty: 0 },
                          ])
                        }
                        data-testid="button-add-prod-row"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Add Item
                      </Button>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setSilentProdOpen(false)}
                        data-testid="button-silent-prod-cancel"
                      >
                        Cancel
                      </Button>
                      <Button
                        disabled={
                          !silentProdLocId ||
                          silentProdItems.every((r) => !r.stockItemId || !r.quantity) ||
                          silentProdApplying
                        }
                        onClick={async () => {
                          const validItems = silentProdItems.filter((r) => r.stockItemId && r.quantity);
                          if (!silentProdLocId || validItems.length === 0) return;
                          setSilentProdApplying(true);
                          try {
                            const res = await apiRequest("POST", "/api/inventory/silent-production", {
                              locationId: silentProdLocId,
                              type: silentProdType,
                              items: validItems.map((r) => ({
                                stockItemId: r.stockItemId,
                                quantity: r.quantity,
                                rate: r.rate || "0",
                              })),
                            });
                            const data = await res.json();
                            setSilentProdDone(data.applied || validItems.length);
                          } catch (err) {
                            console.error("Silent production error:", err);
                          } finally {
                            setSilentProdApplying(false);
                          }
                        }}
                        data-testid="button-silent-prod-apply"
                      >
                        {silentProdApplying ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Applying...
                          </>
                        ) : (
                          `Apply ${silentProdType}`
                        )}
                      </Button>
                    </div>
                  </>
                ) : (
                  /* Import from Excel mode */
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Upload an Excel file with <strong>Code</strong>, <strong>Name</strong>,{" "}
                      <strong>Qty Change</strong>, <strong>Rate</strong> columns. Positive qty = Production (+),
                      Negative qty = Consumption (−). Both can be in the same file.
                    </p>

                    {silentImportPreview.length === 0 ? (
                      <div className="space-y-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={downloadSilentTemplate}
                          data-testid="button-download-silent-template"
                        >
                          <FileDown className="h-4 w-4 mr-1" />
                          Download Template
                        </Button>
                        <label
                          className="flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-md p-8 cursor-pointer hover-elevate text-muted-foreground"
                          data-testid="label-silent-import-dropzone"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (!silentProdLocId) {
                              toast({ title: "Select a location first", variant: "destructive" });
                              return;
                            }
                            const f = e.dataTransfer.files[0];
                            if (f) handleSilentImportFile(f);
                          }}
                        >
                          <input
                            ref={silentImportFileRef}
                            type="file"
                            accept=".xlsx,.xls"
                            className="hidden"
                            data-testid="input-silent-import-file"
                            onChange={(e) => {
                              if (!silentProdLocId) {
                                toast({ title: "Select a location first", variant: "destructive" });
                                return;
                              }
                              const f = e.target.files?.[0];
                              if (f) handleSilentImportFile(f);
                              e.target.value = "";
                            }}
                          />
                          <Upload className="h-8 w-8 opacity-40" />
                          <span className="text-sm font-medium">
                            {silentImportLoading ? "Parsing…" : "Click or drag & drop Excel file"}
                          </span>
                          <span className="text-xs">.xlsx / .xls — select a location first</span>
                        </label>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex gap-3 text-xs font-medium">
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {silentImportPreview.filter((r) => r.change > 0 && r.status !== "not_found").length}{" "}
                              production
                            </span>
                            <span className="text-destructive">
                              {silentImportPreview.filter((r) => r.change < 0 && r.status !== "not_found").length}{" "}
                              consumption
                            </span>
                            {silentImportPreview.filter((r) => r.status === "not_found").length > 0 && (
                              <span className="text-muted-foreground">
                                {silentImportPreview.filter((r) => r.status === "not_found").length} unmatched
                              </span>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={exportSilentExcel}
                              data-testid="button-export-silent-excel"
                            >
                              <FileDown className="h-3 w-3 mr-1" />
                              Excel
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={exportSilentPDF}
                              data-testid="button-export-silent-pdf"
                            >
                              <FileDown className="h-3 w-3 mr-1" />
                              PDF
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSilentImportPreview([]);
                                if (silentImportFileRef.current) silentImportFileRef.current.value = "";
                              }}
                              data-testid="button-clear-silent-import"
                            >
                              Clear
                            </Button>
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
                                  <tr
                                    key={idx}
                                    className={`border-t ${row.status === "not_found" ? "opacity-50" : ""}`}
                                  >
                                    <td className="p-2">
                                      <p className="font-medium truncate max-w-[220px]">{row.stockItemName}</p>
                                      {row.status === "not_found" && (
                                        <p className="text-xs text-destructive">Not found — skipped</p>
                                      )}
                                      {row.status === "to_zero" && (
                                        <p className="text-xs text-amber-600 dark:text-amber-400">Will reach 0</p>
                                      )}
                                    </td>
                                    <td className="p-2 text-right font-mono text-muted-foreground">
                                      {formatNumber(row.currentQty, 0)}
                                    </td>
                                    <td
                                      className={`p-2 text-right font-mono font-semibold ${row.change > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
                                    >
                                      <span className="inline-flex items-center gap-0.5 justify-end">
                                        {row.change > 0 ? (
                                          <TrendingUp className="h-3 w-3" />
                                        ) : (
                                          <TrendingDown className="h-3 w-3" />
                                        )}
                                        {row.change > 0 ? "+" : ""}
                                        {formatNumber(row.change, 0)}
                                      </span>
                                    </td>
                                    <td className="p-2 text-right font-mono font-semibold">
                                      {row.status !== "not_found" ? formatNumber(row.newQty, 0) : "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            onClick={() => setSilentProdOpen(false)}
                            data-testid="button-silent-import-cancel"
                          >
                            Cancel
                          </Button>
                          <Button
                            onClick={applySilentImport}
                            disabled={
                              silentProdApplying ||
                              silentImportPreview.every((r) => r.status === "not_found") ||
                              !silentProdLocId
                            }
                            data-testid="button-silent-import-apply"
                          >
                            {silentProdApplying ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Applying…
                              </>
                            ) : (
                              "Apply Adjustments"
                            )}
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
      <Dialog
        open={silentTransferOpen}
        onOpenChange={(o) => {
          if (!isSilentParsing && !isSilentApplying) setSilentTransferOpen(o);
        }}
      >
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
                      {(locations as unknown[]).map((loc: unknown) => (
                        <SelectItem key={loc.id} value={String(loc.id)}>
                          {loc.name}
                        </SelectItem>
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
                      {(locations as unknown[])
                        .filter((l: unknown) => String(l.id) !== silentSrcId)
                        .map((loc: unknown) => (
                          <SelectItem key={loc.id} value={String(loc.id)}>
                            {loc.name}
                          </SelectItem>
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
                Template columns: <strong>Barcode</strong> (item code), <strong>Quantity</strong> — duplicate barcodes
                are detected automatically.
              </p>

              {silentParseError && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{silentParseError}</AlertDescription>
                </Alert>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setSilentTransferOpen(false)}>
                  Cancel
                </Button>
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
                    } catch (err) {
                      setSilentParseError(getErrorDetails(err).message);
                    } finally {
                      setIsSilentParsing(false);
                    }
                  }}
                  disabled={!silentSrcId || !silentDstId || !silentFile || isSilentParsing}
                  data-testid="button-silent-transfer-parse"
                >
                  {isSilentParsing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Validating...
                    </>
                  ) : (
                    "Validate File"
                  )}
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* STEP 2 — Validation results */}
          {silentStep === "validation" &&
            (() => {
              const applyItems = silentIncludeWarnings ? [...silentValidItems, ...silentWarnItems] : silentValidItems;
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
                              {silentErrorLines.map((e: import("react").SyntheticEvent, i: number) => (
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
                        <div
                          className={`rounded-md border overflow-hidden transition-opacity ${silentIncludeWarnings ? "border-yellow-300 dark:border-yellow-700/50 opacity-100" : "border-muted opacity-60"}`}
                        >
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
                              {silentWarnItems.map((item: unknown, i: number) => (
                                <TableRow
                                  key={i}
                                  className={silentIncludeWarnings ? "bg-yellow-50/60 dark:bg-yellow-950/20" : ""}
                                >
                                  <TableCell className="py-1.5">
                                    <div className="text-xs font-medium">{item.stockItemName}</div>
                                    <div className="text-xs text-muted-foreground font-mono">{item.barcode}</div>
                                  </TableCell>
                                  <TableCell className="text-right text-xs py-1.5">
                                    {formatNumber(item.quantity)}
                                  </TableCell>
                                  <TableCell className="text-right text-xs py-1.5 text-destructive font-medium">
                                    {formatNumber(item.currentStock)}
                                  </TableCell>
                                  <TableCell className="text-xs py-1.5 text-yellow-700 dark:text-yellow-400">
                                    {item.warnReason}
                                  </TableCell>
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
                              {silentValidItems.map((item: unknown, i: number) => (
                                <TableRow key={i} className="bg-green-50/40 dark:bg-green-950/10">
                                  <TableCell className="py-1.5">
                                    <div className="text-xs font-medium">{item.stockItemName}</div>
                                    <div className="text-xs text-muted-foreground font-mono">{item.barcode}</div>
                                  </TableCell>
                                  <TableCell className="text-right text-xs py-1.5">
                                    {formatNumber(item.quantity)}
                                  </TableCell>
                                  <TableCell className="text-right text-xs py-1.5">
                                    {formatNumber(item.currentStock)}
                                  </TableCell>
                                  <TableCell className="text-right text-xs py-1.5 text-green-700 dark:text-green-400 font-medium">
                                    {formatNumber(item.afterTransfer)}
                                  </TableCell>
                                  <TableCell className="text-right text-xs py-1.5 text-muted-foreground">
                                    {formatNumber(item.averageRate, 2)}
                                  </TableCell>
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
                    <Button variant="outline" onClick={() => setSilentStep("setup")} disabled={isSilentApplying}>
                      Back
                    </Button>
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
                        } catch (err) {
                          setSilentParseError(getErrorDetails(err).message);
                          setSilentStep("setup");
                        } finally {
                          setIsSilentApplying(false);
                        }
                      }}
                      disabled={applyItems.length === 0 || isSilentApplying}
                      data-testid="button-silent-transfer-apply"
                    >
                      {isSilentApplying ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Applying...
                        </>
                      ) : applyItems.length === 0 ? (
                        "No items to transfer"
                      ) : (
                        `Apply Transfer (${applyItems.length} item${applyItems.length !== 1 ? "s" : ""})`
                      )}
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
                  {silentAppliedCount} item{silentAppliedCount !== 1 ? "s" : ""} moved silently. No daybook entry was
                  created.
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
              >
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Stock Import Dialog */}
      <Dialog open={stockImportOpen} onOpenChange={handleStockDialogClose}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Stock from Excel</DialogTitle>
            <DialogDescription>Upload an Excel file with Item_barcode, quantity, rate, value columns</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Button
              variant="outline"
              onClick={downloadStockTemplate}
              size="sm"
              data-testid="button-download-stock-template"
            >
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
                    {stockErrors.slice(0, 5).map((err, i) => (
                      <li key={i} className="text-sm">
                        {err}
                      </li>
                    ))}
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
              <Button variant="outline" onClick={handleStockDialogClose} disabled={isImportingStock}>
                Close
              </Button>
              <Button
                onClick={handleStockImport}
                disabled={
                  stockPreview.length === 0 || stockErrors.length > 0 || isImportingStock || stockImportComplete
                }
                data-testid="button-submit-stock-import"
              >
                {isImportingStock ? "Importing..." : "Import Stock"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Rename Dialog */}
      <Dialog open={bulkRenameOpen} onOpenChange={setBulkRenameOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bulk Rename Stock Items</DialogTitle>
            <DialogDescription>Find and replace text across multiple stock item names.</DialogDescription>
          </DialogHeader>
          <BulkRenameTab />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Merge Stock Items Card ────────────────────────────────────────────────────
