import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient, keyStartsWith } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Plus,
  Trash2,
  Star,
  Pencil,
  FileText,
  LayoutGrid,
  Download,
  RefreshCw,
  Search,
  BookOpen,
  PenLine,
  Truck,
  ArrowRightLeft,
  Upload,
  AlertCircle,
  Layers,
  BookmarkCheck,
  ChevronDown,
  ChevronRight,
  Users,
  Package,
  MoreHorizontal,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { DeleteConfirmDialog } from "@/components/ConfirmationDialog";
import { read as readExcel, utils as excelUtils, writeFile as writeExcel } from "@/lib/excelHelper";
import { PageHeader } from "@/components/PageHeader";

interface ProformaLine {
  id: number;
  proformaId: number;
  articleCode: string;
  productName: string;
  quantity: number;
  pricePerBale: string;
  weightPerBaleKg?: string | null;
  pricingMode?: string | null;
  pricePerKg?: string | null;
}

function effectivePricePerBale(line: ProformaLine): number {
  if (line.pricingMode === "per_kg" && line.pricePerKg && line.weightPerBaleKg) {
    const kg = parseFloat(line.weightPerBaleKg);
    const pkk = parseFloat(line.pricePerKg);
    if (kg > 0 && pkk > 0) return kg * pkk;
  }
  return parseFloat(line.pricePerBale) || 0;
}

interface Proforma {
  id: number;
  customerId: number;
  companyId: number;
  name: string;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  lines: ProformaLine[];
}

interface Customer {
  id: number;
  legalName: string;
  balance: number;
  balanceSide: string;
}

export default function FactoryProformas() {
  const { toast } = useToast();
  const { formatAmount } = useCurrencyContext();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const [, navigate] = useLocation();
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("customerId") || "";
  });
  const [expandedProformaIds, setExpandedProformaIds] = useState<Set<number>>(() => {
    const params = new URLSearchParams(window.location.search);
    const ep = params.get("expandProformaId");
    return ep ? new Set([parseInt(ep, 10)]) : new Set();
  });
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newProformaName, setNewProformaName] = useState("");
  const [isAddLineOpen, setIsAddLineOpen] = useState(false);
  const [addLineProformaId, setAddLineProformaId] = useState<number | null>(null);
  const [newLine, setNewLine] = useState({ articleCode: "", productName: "", quantity: "", pricePerBale: "" });
  const [editingLine, setEditingLine] = useState<ProformaLine | null>(null);
  const [editLineValues, setEditLineValues] = useState({
    productName: "",
    quantity: "",
    pricePerBale: "",
    weightPerBaleKg: "",
  });
  const [pendingDelete, setPendingDelete] = useState<(() => void) | null>(null);
  const [inlineQtyLineId, setInlineQtyLineId] = useState<number | null>(null);
  const [inlineQtyValue, setInlineQtyValue] = useState<string>("");
  const [renamingProforma, setRenamingProforma] = useState<Proforma | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [addLineMode, setAddLineMode] = useState<"manual" | "catalog">("catalog");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogSelectedItem, setCatalogSelectedItem] = useState<any | null>(null);
  const [createLoadingProforma, setCreateLoadingProforma] = useState<Proforma | null>(null);
  const [createLoadingLocationId, setCreateLoadingLocationId] = useState<string>("");
  const [transferProforma, setTransferProforma] = useState<Proforma | null>(null);
  const [transferTargetCustomerId, setTransferTargetCustomerId] = useState<string>("");
  const [showInactive, setShowInactive] = useState(false);
  const [proformaSearch, setProformaSearch] = useState("");

  // Excel import state
  const [isExcelImportOpen, setIsExcelImportOpen] = useState(false);
  const [excelImportName, setExcelImportName] = useState("");
  const [excelImportLines, setExcelImportLines] = useState<
    { articleCode: string; productName: string; quantity: string; pricePerBale: string }[]
  >([]);
  const [excelImportErrors, setExcelImportErrors] = useState<string[]>([]);
  const [excelImportLoading, setExcelImportLoading] = useState(false);
  const excelFileInputRef = useRef<HTMLInputElement>(null);

  const customerId = selectedCustomerId ? parseInt(selectedCustomerId) : null;

  const { data: myAccess } = useQuery<{ fullAccess: boolean; hiddenCostFields: string[] }>({
    queryKey: ["/api/factory/my-access"],
  });
  const hideProformaPrice = myAccess?.hiddenCostFields?.includes("hide_proforma_price") ?? false;

  const { data: currentUser } = useQuery<{ role: string }>({ queryKey: ["/api/auth/me"] });
  const canEdit = ["Admin", "Owner", "Developer"].includes(currentUser?.role || "");

  const { data: customers = [], isLoading: customersLoading } = useQuery<Customer[]>({
    queryKey: ["/api/factory/customers"],
  });

  const { data: proformas = [], isLoading: proformasLoading } = useQuery<Proforma[]>({
    queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId],
    enabled: !!customerId,
  });

  const { data: allStockItems = [] } = useQuery<any[]>({
    queryKey: ["/api/stock-items"],
    enabled: isAddLineOpen || expandedProformaIds.size > 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Customer price list — used to auto-fill price when adding a new line
  const { data: customerPriceList = [] } = useQuery<{ articleCode: string; pricePerBale: string }[]>({
    queryKey: [`/api/factory/customer-price-lists/${customerId}`, customerId],
    enabled: !!customerId && isAddLineOpen,
  });

  const priceListMap = Object.fromEntries(customerPriceList.map((p) => [p.articleCode, p.pricePerBale]));

  const { data: locations = [] } = useQuery<{ id: number; name: string; code: string }[]>({
    queryKey: ["/api/locations"],
    enabled: !!createLoadingProforma,
  });

  const createLoadingMutation = useMutation({
    mutationFn: async ({ proformaId, locationId }: { proformaId: number; locationId: string }) => {
      const res = await modeApiRequest("POST", `/api/factory/customer-proformas/${proformaId}/create-loading`, {
        locationId: parseInt(locationId),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.message);
      }
      return res.json();
    },
    onSuccess: (data) => {
      const balesAdded = data.balesAdded ?? 0;
      toast({
        title: "Pending Loading Created",
        description: `Loading #${data.order.id} created — ${balesAdded} bale${balesAdded !== 1 ? "s" : ""} added from stock`,
      });
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-orders") });
      setCreateLoadingProforma(null);
      setCreateLoadingLocationId("");
      navigate("/factory/sales/loadings");
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createProformaMutation = useMutation({
    mutationFn: async (data: { customerId: number; name: string; isActive: boolean }) => {
      return await modeApiRequest("POST", "/api/factory/customer-proformas", data);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Proforma created successfully" });
      queryClient.invalidateQueries({
        queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId],
      });
      setIsCreateOpen(false);
      setNewProformaName("");
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      return await modeApiRequest("PUT", `/api/factory/customer-proformas/${id}`, { isActive });
    },
    onSuccess: (_, vars) => {
      toast({ title: vars.isActive ? "Proforma activated" : "Proforma deactivated" });
      queryClient.invalidateQueries({
        queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId],
      });
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      const msg = error.message || "";
      const isStockError = msg.includes("insufficient") || msg.includes("free stock") || msg.includes("needs");
      toast({
        title: isStockError ? "Cannot activate — insufficient stock" : "Error",
        description: isStockError
          ? "One or more articles don't have enough available stock to fulfil this proforma."
          : msg.slice(0, 200),
        variant: "destructive",
      });
    },
  });

  const deleteProformaMutation = useMutation({
    mutationFn: async (id: number) => {
      return await modeApiRequest("DELETE", `/api/factory/customer-proformas/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Proforma deleted" });
      queryClient.invalidateQueries({
        queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId],
      });
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const renameProformaMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      return await modeApiRequest("PUT", `/api/factory/customer-proformas/${id}`, { name });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Proforma renamed successfully" });
      queryClient.invalidateQueries({
        queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId],
      });
      setRenamingProforma(null);
      setRenameValue("");
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const transferProformaMutation = useMutation({
    mutationFn: async ({ id, targetCustomerId }: { id: number; targetCustomerId: number }) => {
      return await modeApiRequest("PATCH", `/api/factory/customer-proformas/${id}/transfer`, { targetCustomerId });
    },
    onSuccess: (data: any) => {
      toast({ title: "Proforma transferred", description: `Proforma moved to ${data.targetCustomerName}` });
      queryClient.invalidateQueries({
        queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId],
      });
      setTransferProforma(null);
      setTransferTargetCustomerId("");
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Transfer failed", description: error.message, variant: "destructive" });
    },
  });

  const addLineMutation = useMutation({
    mutationFn: async (data: {
      proformaId: number;
      articleCode: string;
      productName: string;
      quantity: number;
      pricePerBale: string;
    }) => {
      return await modeApiRequest("POST", "/api/factory/customer-proforma-lines", data);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Line added" });
      queryClient.invalidateQueries({
        queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId],
      });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-price-lists/${customerId}`, customerId] });
      setIsAddLineOpen(false);
      setAddLineProformaId(null);
      setNewLine({ articleCode: "", productName: "", quantity: "", pricePerBale: "" });
      setCatalogSelectedItem(null);
      setCatalogSearch("");
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const editLineMutation = useMutation({
    mutationFn: async (data: {
      id: number;
      pricePerBale: string;
      productName: string;
      quantity: string;
      weightPerBaleKg: string;
    }) => {
      return await modeApiRequest("PUT", `/api/factory/customer-proforma-lines/${data.id}`, {
        pricePerBale: data.pricePerBale,
        productName: data.productName,
        quantity: data.quantity,
        weightPerBaleKg: data.weightPerBaleKg !== "" ? data.weightPerBaleKg : undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Line updated" });
      queryClient.invalidateQueries({
        queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId],
      });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-price-lists/${customerId}`, customerId] });
      setEditingLine(null);
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteLineMutation = useMutation({
    mutationFn: async (id: number) => {
      return await modeApiRequest("DELETE", `/api/factory/customer-proforma-lines/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Line deleted" });
      queryClient.invalidateQueries({
        queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId],
      });
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const inlineQtyMutation = useMutation({
    mutationFn: async ({ id, quantity }: { id: number; quantity: number }) => {
      const res = await modeApiRequest("PUT", `/api/factory/customer-proforma-lines/${id}`, { quantity });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId],
      });
      setInlineQtyLineId(null);
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setInlineQtyLineId(null);
    },
  });

  const commitInlineQty = (lineId: number) => {
    const qty = parseInt(inlineQtyValue);
    if (!isNaN(qty) && qty >= 1) {
      inlineQtyMutation.mutate({ id: lineId, quantity: qty });
    } else {
      setInlineQtyLineId(null);
    }
  };

  const formatProformaDate = (createdAt: string | null, updatedAt: string | null): { label: string; value: string } => {
    const created = createdAt ? new Date(createdAt) : null;
    const updated = updatedAt ? new Date(updatedAt) : null;
    const fmt = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    if (updated && created && updated.getTime() - created.getTime() > 60_000) {
      return { label: "Edited", value: fmt(updated) };
    }
    if (created) {
      return { label: "Created", value: fmt(created) };
    }
    return { label: "", value: "" };
  };

  const bulkImportMutation = useMutation({
    mutationFn: async (data: { customerId: number; name: string; isActive: boolean; lines: any[] }) => {
      const res = await modeApiRequest("POST", "/api/factory/customer-proformas/bulk", data);
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.message);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Proforma created", description: "Excel data imported successfully" });
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-proformas") });
      setIsExcelImportOpen(false);
      setExcelImportName("");
      setExcelImportLines([]);
      setExcelImportErrors([]);
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const downloadProformaTemplate = async () => {
    const wb = excelUtils.book_new();
    const sampleData = [
      { "Article Code": "A001", "Product Name": "Mixed Cotton Bales", Quantity: 50, "Price Per Bale": 45.0 },
      { "Article Code": "A002", "Product Name": "White Cotton Bales", Quantity: 30, "Price Per Bale": 52.5 },
      { "Article Code": "B001", "Product Name": "Polyester Mix Bales", Quantity: 20, "Price Per Bale": 38.0 },
    ];
    const sheet = excelUtils.json_to_sheet(sampleData);
    excelUtils.book_append_sheet(wb, sheet, "Proforma");
    await writeExcel(wb, "proforma_template.xlsx");
  };

  const handleExcelFile = async (file: File) => {
    setExcelImportLoading(true);
    setExcelImportErrors([]);
    setExcelImportLines([]);
    try {
      const workbook = await readExcel(file);
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) {
        setExcelImportErrors(["No sheets found in this file"]);
        return;
      }
      const rows = excelUtils.sheet_to_json<Record<string, any>>(firstSheet);
      if (rows.length === 0) {
        setExcelImportErrors(["The sheet appears to be empty"]);
        return;
      }

      // Smart column detection — case-insensitive, multiple aliases
      const normalize = (s: string) =>
        String(s ?? "")
          .toLowerCase()
          .replace(/[\s_\-]/g, "");
      const findCol = (row: Record<string, any>, aliases: string[]): string => {
        const keys = Object.keys(row);
        for (const alias of aliases) {
          const found = keys.find((k) => normalize(k) === alias);
          if (found) return String(row[found] ?? "").trim();
        }
        return "";
      };

      const parsed: { articleCode: string; productName: string; quantity: string; pricePerBale: string }[] = [];
      const errors: string[] = [];

      rows.forEach((row, i) => {
        const articleCode = findCol(row, ["articlecode", "code", "article", "artcode", "sku", "ref"]);
        const productName = findCol(row, ["productname", "name", "product", "description", "item", "itemname"]);
        const quantity = findCol(row, ["quantity", "qty", "bales", "count"]);
        const pricePerBale = findCol(row, ["priceperbale", "price", "rate", "unitprice", "saleprice", "sellingprice"]);

        if (!articleCode && !productName) {
          errors.push(`Row ${i + 2}: Missing article code and product name — skipped`);
          return;
        }
        if (!articleCode) {
          errors.push(`Row ${i + 2}: Missing article code — skipped`);
          return;
        }
        if (!productName) {
          errors.push(`Row ${i + 2}: Missing product name — skipped`);
          return;
        }
        const qty = parseInt(quantity);
        if (isNaN(qty) || qty <= 0) {
          errors.push(`Row ${i + 2}: Invalid quantity "${quantity}" — skipped`);
          return;
        }

        parsed.push({ articleCode, productName, quantity: String(qty), pricePerBale: pricePerBale || "0" });
      });

      if (errors.length > 0) setExcelImportErrors(errors);
      if (parsed.length === 0) {
        setExcelImportErrors((prev) => [
          ...prev,
          "No valid rows found. Check that columns are named: Article Code, Product Name, Quantity, Price Per Bale",
        ]);
        return;
      }
      setExcelImportLines(parsed);
      // Suggest a proforma name from the filename
      if (!excelImportName) {
        const base = file.name
          .replace(/\.(xlsx?|csv)$/i, "")
          .replace(/[_\-]+/g, " ")
          .trim();
        setExcelImportName(base || "Imported Proforma");
      }
    } catch (err: any) {
      setExcelImportErrors([`Failed to read file: ${err?.message || "Unknown error"}`]);
    } finally {
      setExcelImportLoading(false);
    }
  };

  const saveAgreedPricesMutation = useMutation({
    mutationFn: async (proformaId: number) => {
      if (!customerId) throw new Error("No customer selected");
      const res = await modeApiRequest(
        "POST",
        `/api/factory/customer-price-lists/${customerId}/from-proforma/${proformaId}`,
        {}
      );
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId],
      });
      const backfillNote =
        result.backfilled > 0
          ? ` Updated ${result.backfilled} line${result.backfilled !== 1 ? "s" : ""} across all existing proformas.`
          : "";
      toast({
        title: "Agreed prices saved",
        description: `${result.saved} price${result.saved !== 1 ? "s" : ""} saved.${backfillNote}`,
      });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const applyCatalogPricesMutation = useMutation({
    mutationFn: async (proformaId: number) => {
      const res = await modeApiRequest(
        "POST",
        `/api/factory/customer-proformas/${proformaId}/apply-catalog-prices`,
        {}
      );
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId],
      });
      const msg =
        result.skipped > 0
          ? `${result.updated} line(s) updated, ${result.skipped} skipped (no selling price)`
          : `${result.updated} line(s) updated with selling prices`;
      toast({ title: "Selling Prices Applied", description: msg });
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const applyProductionPricesMutation = useMutation({
    mutationFn: async (proformaId: number) => {
      const res = await modeApiRequest(
        "POST",
        `/api/factory/customer-proformas/${proformaId}/apply-production-prices`,
        {}
      );
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId],
      });
      const msg =
        result.skipped > 0
          ? `${result.updated} line(s) updated, ${result.skipped} skipped (no production price)`
          : `${result.updated} line(s) updated with production prices`;
      toast({ title: "Production Prices Applied", description: msg });
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleCreateProforma = () => {
    if (!newProformaName.trim() || !customerId) return;
    createProformaMutation.mutate({
      customerId,
      name: newProformaName.trim(),
      isActive: false,
    });
  };

  const handleAddLine = () => {
    if (
      !addLineProformaId ||
      !newLine.articleCode.trim() ||
      !newLine.productName.trim() ||
      !newLine.quantity ||
      !newLine.pricePerBale
    )
      return;
    addLineMutation.mutate({
      proformaId: addLineProformaId,
      articleCode: newLine.articleCode.trim(),
      productName: newLine.productName.trim(),
      quantity: parseInt(newLine.quantity),
      pricePerBale: newLine.pricePerBale,
    });
  };

  const handleEditLine = () => {
    if (!editingLine || !editLineValues.pricePerBale || !editLineValues.quantity) return;
    editLineMutation.mutate({
      id: editingLine.id,
      pricePerBale: editLineValues.pricePerBale,
      productName: editLineValues.productName,
      quantity: editLineValues.quantity,
      weightPerBaleKg: editLineValues.weightPerBaleKg,
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 pt-6 pb-4 border-b">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Customer Proformas</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Price lists for bale sales per customer</p>
        </div>
        {customerId && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              data-testid="button-import-excel-proforma"
              onClick={() => {
                setExcelImportName("");
                setExcelImportLines([]);
                setExcelImportErrors([]);
                setIsExcelImportOpen(true);
              }}
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Import Excel
            </Button>
            <Button size="sm" data-testid="button-create-proforma" onClick={() => setIsCreateOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New Proforma
            </Button>
          </div>
        )}
      </div>

      {/* ── Customer picker ──────────────────────────────────────────────── */}
      <div className="px-6 py-4 border-b bg-muted/30">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 min-w-[220px] flex-1 max-w-sm">
            <Users className="h-4 w-4 text-muted-foreground shrink-0" />
            {customersLoading ? (
              <Skeleton className="h-9 flex-1" />
            ) : (
              <Select
                value={selectedCustomerId}
                onValueChange={(val) => {
                  setSelectedCustomerId(val);
                  setExpandedProformaIds(new Set());
                  setProformaSearch("");
                }}
              >
                <SelectTrigger data-testid="select-customer" className="flex-1">
                  <SelectValue placeholder="Select a customer to view proformas..." />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()} data-testid={`select-customer-option-${c.id}`}>
                      {c.legalName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {customerId && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={proformaSearch}
                onChange={(e) => setProformaSearch(e.target.value)}
                placeholder="Search proformas…"
                className="pl-8 h-9 w-52 text-sm"
                data-testid="input-proforma-search"
              />
              {proformaSearch && (
                <button
                  onClick={() => setProformaSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover-elevate rounded"
                  data-testid="button-clear-proforma-search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Content area ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-6 py-5">
        {/* Loading skeletons */}
        {customerId && proformasLoading && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton className="h-20 w-full rounded-lg" key={i} />
            ))}
          </div>
        )}

        {/* Empty: no customer selected */}
        {!customerId && !customersLoading && (
          <div
            className="flex flex-col items-center justify-center py-20 text-center"
            data-testid="text-select-customer"
          >
            <div className="rounded-full bg-muted p-4 mb-4">
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="font-medium text-muted-foreground">No customer selected</p>
            <p className="text-sm text-muted-foreground mt-1">Pick a customer above to view their proformas</p>
          </div>
        )}

        {/* Empty: customer selected but no proformas */}
        {customerId && !proformasLoading && proformas.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center" data-testid="text-no-proformas">
            <div className="rounded-full bg-muted p-4 mb-4">
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="font-medium text-muted-foreground">No proformas yet</p>
            <p className="text-sm text-muted-foreground mt-1">Create a proforma to define this customer's pricing</p>
            <Button size="sm" className="mt-4" onClick={() => setIsCreateOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New Proforma
            </Button>
          </div>
        )}

        {/* Proforma list */}
        {customerId && !proformasLoading && proformas.length > 0 && (
          <div className="space-y-3">
            {/* Inactive toggle + search status */}
            {(() => {
              const inactiveCount = proformas.filter((p) => !p.isActive).length;
              const searchTerm = proformaSearch.trim().toLowerCase();
              const visibleProformas = proformas
                .filter((p) => p.isActive || showInactive)
                .filter((p) => !searchTerm || p.name.toLowerCase().includes(searchTerm));
              const allExpanded =
                visibleProformas.length > 0 && visibleProformas.every((p) => expandedProformaIds.has(p.id));
              return (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  {searchTerm ? (
                    <p className="text-sm text-muted-foreground">
                      {visibleProformas.length === 0
                        ? `No proformas match "${proformaSearch}"`
                        : `${visibleProformas.length} proforma${visibleProformas.length !== 1 ? "s" : ""} matching "${proformaSearch}"`}
                    </p>
                  ) : (
                    <div />
                  )}
                  <div className="flex items-center gap-2 ml-auto">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (allExpanded) {
                          setExpandedProformaIds(new Set());
                        } else {
                          setExpandedProformaIds(new Set(visibleProformas.map((p) => p.id)));
                        }
                      }}
                      data-testid="button-expand-collapse-all"
                      className="text-muted-foreground"
                    >
                      {allExpanded ? "Collapse all" : "Expand all"}
                    </Button>
                    {inactiveCount > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowInactive((v) => !v)}
                        data-testid="button-toggle-inactive-proformas"
                        className="text-muted-foreground"
                      >
                        {showInactive ? `Hide inactive (${inactiveCount})` : `Show inactive (${inactiveCount})`}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })()}

            {proformas
              .filter((p) => p.isActive || showInactive)
              .filter(
                (p) => !proformaSearch.trim() || p.name.toLowerCase().includes(proformaSearch.trim().toLowerCase())
              )
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((proforma) => {
                const isExpanded = expandedProformaIds.has(proforma.id);
                const totalQty = proforma.lines?.reduce((s, l) => s + l.quantity, 0) ?? 0;
                const totalWeight =
                  proforma.lines?.reduce((s, l) => s + l.quantity * parseFloat(l.weightPerBaleKg || "0"), 0) ?? 0;
                const totalAmount = proforma.lines?.reduce((s, l) => s + l.quantity * effectivePricePerBale(l), 0) ?? 0;
                const lineCount = proforma.lines?.length ?? 0;
                const d = formatProformaDate(proforma.createdAt, proforma.updatedAt);

                return (
                  <div
                    key={proforma.id}
                    data-testid={`card-proforma-${proforma.id}`}
                    className={`rounded-lg border bg-card transition-shadow ${isExpanded ? "shadow-sm" : ""} ${!proforma.isActive ? "opacity-60" : ""}`}
                  >
                    {/* Card header row */}
                    <div className="flex items-center gap-2 px-4 py-3">
                      {/* Expand toggle */}
                      <button
                        className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                        onClick={() =>
                          setExpandedProformaIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(proforma.id)) next.delete(proforma.id);
                            else next.add(proforma.id);
                            return next;
                          })
                        }
                        data-testid={`button-expand-proforma-${proforma.id}`}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <span className="font-semibold truncate">{proforma.name}</span>
                        {proforma.isActive && (
                          <Badge
                            className="bg-green-600 text-white shrink-0 no-default-hover-elevate no-default-active-elevate"
                            data-testid={`badge-active-${proforma.id}`}
                          >
                            Active
                          </Badge>
                        )}
                      </button>

                      {/* Stats chips (hidden on tiny screens) */}
                      <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                        <span data-testid={`badge-lines-count-${proforma.id}`} className="flex items-center gap-1">
                          <Package className="h-3 w-3" />
                          {lineCount} lines
                        </span>
                        {totalQty > 0 && (
                          <span data-testid={`text-total-qty-${proforma.id}`} className="font-mono">
                            {totalQty.toLocaleString()} bales
                          </span>
                        )}
                        {totalWeight > 0 && (
                          <span data-testid={`text-total-weight-${proforma.id}`} className="font-mono">
                            {totalWeight.toLocaleString(undefined, {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 0,
                            })}{" "}
                            kg
                          </span>
                        )}
                        {!hideProformaPrice && totalAmount > 0 && (
                          <span
                            data-testid={`text-total-amount-${proforma.id}`}
                            className="font-mono font-medium text-foreground"
                          >
                            {formatAmount(totalAmount)}
                          </span>
                        )}
                        {d.value && (
                          <span data-testid={`text-proforma-date-${proforma.id}`} className="text-muted-foreground/70">
                            {d.label} {d.value}
                          </span>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-0.5 shrink-0 ml-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleActiveMutation.mutate({ id: proforma.id, isActive: !proforma.isActive })}
                          disabled={toggleActiveMutation.isPending}
                          data-testid={`button-toggle-active-proforma-${proforma.id}`}
                          title={proforma.isActive ? "Deactivate" : "Set active"}
                        >
                          <Star
                            className={
                              proforma.isActive
                                ? "h-4 w-4 fill-yellow-400 text-yellow-500"
                                : "h-4 w-4 text-muted-foreground"
                            }
                          />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            navigate(
                              `/factory/dispatch-batches?customerId=${customerId}&proformaId=${proforma.id}&openCreate=1`
                            )
                          }
                          data-testid={`button-create-dispatch-batch-${proforma.id}`}
                          title="Create dispatch batch"
                        >
                          <Truck className="h-4 w-4 text-muted-foreground" />
                        </Button>
                        {canEdit && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" data-testid={`button-proforma-menu-${proforma.id}`}>
                                <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  setRenamingProforma(proforma);
                                  setRenameValue(proforma.name);
                                }}
                                data-testid={`button-rename-proforma-${proforma.id}`}
                              >
                                <Pencil className="h-3.5 w-3.5 mr-2" />
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setTransferProforma(proforma);
                                  setTransferTargetCustomerId("");
                                }}
                                data-testid={`button-transfer-proforma-${proforma.id}`}
                              >
                                <ArrowRightLeft className="h-3.5 w-3.5 mr-2" />
                                Transfer customer
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setPendingDelete(() => () => deleteProformaMutation.mutate(proforma.id))}
                                data-testid={`button-delete-proforma-${proforma.id}`}
                              >
                                <Trash2 className="h-3.5 w-3.5 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="border-t">
                        {/* Toolbar */}
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/30 flex-wrap">
                          {canEdit && (
                            <Button
                              size="sm"
                              onClick={() => {
                                setAddLineProformaId(proforma.id);
                                setAddLineMode("catalog");
                                setCatalogSelectedItem(null);
                                setCatalogSearch("");
                                setNewLine({ articleCode: "", productName: "", quantity: "", pricePerBale: "" });
                                setIsAddLineOpen(true);
                              }}
                              data-testid={`button-add-line-${proforma.id}`}
                            >
                              <Plus className="mr-1.5 h-3.5 w-3.5" />
                              Add Item
                            </Button>
                          )}
                          {canEdit && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                navigate(`/factory/stock-allocation-v5?proformaId=${proforma.id}&openEdit=true`)
                              }
                              data-testid={`button-edit-in-allocation-${proforma.id}`}
                            >
                              <Pencil className="mr-1.5 h-3.5 w-3.5" />
                              Edit in Stock Allocation
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => saveAgreedPricesMutation.mutate(proforma.id)}
                            disabled={saveAgreedPricesMutation.isPending}
                            data-testid={`button-save-agreed-prices-${proforma.id}`}
                            title="Save these prices as the customer's agreed prices"
                          >
                            <BookmarkCheck className="mr-1.5 h-3.5 w-3.5" />
                            Save as Agreed Prices
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => applyProductionPricesMutation.mutate(proforma.id)}
                            disabled={applyProductionPricesMutation.isPending}
                            data-testid={`button-apply-production-prices-${proforma.id}`}
                            title="Set all line prices to the production (cost) price from the catalogue"
                          >
                            Apply Production Price
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => applyCatalogPricesMutation.mutate(proforma.id)}
                            disabled={applyCatalogPricesMutation.isPending}
                            data-testid={`button-apply-selling-prices-${proforma.id}`}
                            title="Set all line prices to the selling price from the catalogue"
                          >
                            Apply Selling Price
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              window.open(`/api/factory/customer-proformas/${proforma.id}/export/excel`, "_blank")
                            }
                            data-testid={`button-export-excel-${proforma.id}`}
                          >
                            <Download className="mr-1.5 h-3.5 w-3.5" />
                            Excel
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (!navigator.onLine) {
                                window.print();
                                return;
                              }
                              window.open(`/api/factory/customer-proformas/${proforma.id}/export/pdf`, "_blank");
                            }}
                            data-testid={`button-export-pdf-${proforma.id}`}
                          >
                            <Download className="mr-1.5 h-3.5 w-3.5" />
                            PDF
                          </Button>
                        </div>

                        {/* Price lines table */}
                        {proforma.lines && proforma.lines.length > 0 ? (
                          <div>
                            <Table wrapperClassName="max-h-[400px] overflow-auto">
                              <TableHeader className="sticky top-0 z-30 bg-background">
                                <TableRow>
                                  <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                                    Article Code
                                  </TableHead>
                                  <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                                    Product Name
                                  </TableHead>
                                  <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">
                                    Qty
                                  </TableHead>
                                  <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">
                                    Kg/Bale
                                  </TableHead>
                                  <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">
                                    Total Kg
                                  </TableHead>
                                  {!hideProformaPrice && (
                                    <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">
                                      Price/Bale
                                    </TableHead>
                                  )}
                                  {canEdit && <TableHead className="w-[72px]"></TableHead>}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {[...proforma.lines]
                                  .sort((a, b) =>
                                    (a.productName || a.articleCode || "").localeCompare(
                                      b.productName || b.articleCode || ""
                                    )
                                  )
                                  .map((line) => {
                                    const lineWt = parseFloat(line.weightPerBaleKg || "0");
                                    const lineTotal = line.quantity * lineWt;
                                    const isEditingQty = inlineQtyLineId === line.id;
                                    return (
                                      <TableRow
                                        key={line.id}
                                        className="hover:bg-muted/40"
                                        data-testid={`row-line-${line.id}`}
                                      >
                                        <TableCell
                                          className="font-mono text-xs text-muted-foreground py-2.5"
                                          data-testid={`text-article-code-${line.id}`}
                                        >
                                          {line.articleCode}
                                        </TableCell>
                                        <TableCell
                                          className="text-sm font-medium py-2.5"
                                          data-testid={`text-product-name-${line.id}`}
                                        >
                                          {line.productName}
                                        </TableCell>
                                        <TableCell
                                          className="text-right font-mono py-2.5"
                                          data-testid={`text-quantity-${line.id}`}
                                        >
                                          {canEdit && isEditingQty ? (
                                            <Input
                                              type="number"
                                              min="1"
                                              className="w-20 h-7 text-right font-mono text-sm ml-auto"
                                              value={inlineQtyValue}
                                              onChange={(e) => setInlineQtyValue(e.target.value)}
                                              onBlur={() => commitInlineQty(line.id)}
                                              onKeyDown={(e) => {
                                                if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault();
                                                if (e.key === "Enter") commitInlineQty(line.id);
                                                if (e.key === "Escape") setInlineQtyLineId(null);
                                              }}
                                              autoFocus
                                              data-testid={`input-inline-qty-${line.id}`}
                                            />
                                          ) : canEdit ? (
                                            <button
                                              className="font-mono hover:underline hover:text-primary cursor-pointer w-full text-right"
                                              title="Click to edit quantity"
                                              onClick={() => {
                                                setInlineQtyLineId(line.id);
                                                setInlineQtyValue(String(line.quantity));
                                              }}
                                              data-testid={`button-inline-qty-${line.id}`}
                                            >
                                              {line.quantity}
                                            </button>
                                          ) : (
                                            <span className="font-mono">{line.quantity}</span>
                                          )}
                                        </TableCell>
                                        <TableCell
                                          className="text-right font-mono text-sm text-muted-foreground py-2.5"
                                          data-testid={`text-kg-bale-${line.id}`}
                                        >
                                          {lineWt % 1 === 0 ? lineWt.toLocaleString() : lineWt.toFixed(2)}
                                        </TableCell>
                                        <TableCell
                                          className="text-right font-mono text-sm text-muted-foreground py-2.5"
                                          data-testid={`text-total-kg-${line.id}`}
                                        >
                                          {lineTotal > 0
                                            ? lineTotal % 1 === 0
                                              ? lineTotal.toLocaleString()
                                              : lineTotal.toFixed(1)
                                            : "—"}
                                        </TableCell>
                                        {!hideProformaPrice && (
                                          <TableCell
                                            className="text-right font-mono font-medium py-2.5"
                                            data-testid={`text-price-${line.id}`}
                                          >
                                            {formatAmount(effectivePricePerBale(line))}
                                            {line.pricingMode === "per_kg" && line.pricePerKg && (
                                              <div className="text-[10px] text-muted-foreground font-normal">
                                                ${parseFloat(line.pricePerKg).toFixed(2)}/kg
                                              </div>
                                            )}
                                          </TableCell>
                                        )}
                                        {canEdit && (
                                          <TableCell className="py-2.5">
                                            <div className="flex items-center gap-0.5 justify-end">
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                onClick={() => {
                                                  setEditingLine(line);
                                                  setEditLineValues({
                                                    productName: line.productName,
                                                    quantity: String(line.quantity),
                                                    pricePerBale: line.pricePerBale,
                                                    weightPerBaleKg: line.weightPerBaleKg ?? "",
                                                  });
                                                }}
                                                data-testid={`button-edit-line-${line.id}`}
                                              >
                                                <Pencil className="h-3 w-3" />
                                              </Button>
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                onClick={() =>
                                                  setPendingDelete(() => () => deleteLineMutation.mutate(line.id))
                                                }
                                                disabled={deleteLineMutation.isPending}
                                                data-testid={`button-delete-line-${line.id}`}
                                              >
                                                <Trash2 className="h-3 w-3 text-destructive/70" />
                                              </Button>
                                            </div>
                                          </TableCell>
                                        )}
                                      </TableRow>
                                    );
                                  })}
                              </TableBody>
                            </Table>

                            {/* Summary footer */}
                            <div className="flex items-center gap-6 px-4 py-3 bg-muted/20 border-t text-sm flex-wrap">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">Bales</span>
                                <span className="font-semibold font-mono" data-testid={`text-total-qty-${proforma.id}`}>
                                  {totalQty.toLocaleString()}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">Weight</span>
                                <span
                                  className="font-semibold font-mono"
                                  data-testid={`text-total-weight-${proforma.id}`}
                                >
                                  {totalWeight.toLocaleString(undefined, {
                                    minimumFractionDigits: 1,
                                    maximumFractionDigits: 1,
                                  })}{" "}
                                  kg
                                </span>
                              </div>
                              {!hideProformaPrice && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs text-muted-foreground">Total</span>
                                  <span
                                    className="font-semibold font-mono"
                                    data-testid={`text-total-amount-${proforma.id}`}
                                  >
                                    {formatAmount(totalAmount)}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div
                            className="flex flex-col items-center py-10 text-center"
                            data-testid={`text-no-lines-${proforma.id}`}
                          >
                            <Package className="h-8 w-8 text-muted-foreground/40 mb-2" />
                            <p className="text-sm text-muted-foreground">No price lines yet</p>
                            {canEdit && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="mt-3"
                                onClick={() => {
                                  setAddLineProformaId(proforma.id);
                                  setAddLineMode("catalog");
                                  setCatalogSelectedItem(null);
                                  setCatalogSearch("");
                                  setNewLine({ articleCode: "", productName: "", quantity: "", pricePerBale: "" });
                                  setIsAddLineOpen(true);
                                }}
                              >
                                <Plus className="mr-1.5 h-3.5 w-3.5" />
                                Add first item
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Proforma</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Proforma Name</label>
              <Input
                placeholder="e.g. Summer 2024 Pricing"
                value={newProformaName}
                onChange={(e) => setNewProformaName(e.target.value)}
                data-testid="input-proforma-name"
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setIsCreateOpen(false)} data-testid="button-cancel-create">
                Cancel
              </Button>
              <Button
                onClick={handleCreateProforma}
                disabled={!newProformaName.trim() || createProformaMutation.isPending}
                data-testid="button-confirm-create"
              >
                Create Proforma
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!renamingProforma}
        onOpenChange={(open) => {
          if (!open) {
            setRenamingProforma(null);
            setRenameValue("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Proforma</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">New Name</label>
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                placeholder="e.g. Summer 2024 Pricing"
                data-testid="input-rename-proforma"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && renameValue.trim() && renameValue.trim() !== renamingProforma?.name) {
                    renameProformaMutation.mutate({ id: renamingProforma!.id, name: renameValue.trim() });
                  }
                }}
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setRenamingProforma(null);
                  setRenameValue("");
                }}
                data-testid="button-cancel-rename"
              >
                Cancel
              </Button>
              <Button
                onClick={() => renameProformaMutation.mutate({ id: renamingProforma!.id, name: renameValue.trim() })}
                disabled={
                  renameProformaMutation.isPending ||
                  !renameValue.trim() ||
                  renameValue.trim() === renamingProforma?.name
                }
                data-testid="button-submit-rename"
              >
                {renameProformaMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Transfer Proforma Dialog ────────────────────────────────────── */}
      <Dialog
        open={!!transferProforma}
        onOpenChange={(open) => {
          if (!open) {
            setTransferProforma(null);
            setTransferTargetCustomerId("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Transfer Proforma</DialogTitle>
            <DialogDescription>
              Move <strong>{transferProforma?.name}</strong> to a different customer. All lines and reservations will be
              moved with it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Current Customer</label>
              <p className="text-sm text-muted-foreground">
                {customers.find((c: Customer) => c.id === transferProforma?.customerId)?.legalName ?? "—"}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Transfer To</label>
              <Select value={transferTargetCustomerId} onValueChange={setTransferTargetCustomerId}>
                <SelectTrigger data-testid="select-transfer-customer">
                  <SelectValue placeholder="Select customer..." />
                </SelectTrigger>
                <SelectContent>
                  {customers
                    .filter((c: Customer) => c.id !== transferProforma?.customerId)
                    .map((c: Customer) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.legalName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setTransferProforma(null);
                  setTransferTargetCustomerId("");
                }}
                data-testid="button-cancel-transfer"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (!transferProforma || !transferTargetCustomerId) return;
                  transferProformaMutation.mutate({
                    id: transferProforma.id,
                    targetCustomerId: parseInt(transferTargetCustomerId),
                  });
                }}
                disabled={!transferTargetCustomerId || transferProformaMutation.isPending}
                data-testid="button-confirm-transfer"
              >
                {transferProformaMutation.isPending ? "Transferring..." : "Transfer"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isAddLineOpen}
        onOpenChange={(open) => {
          setIsAddLineOpen(open);
          if (!open) {
            setCatalogSelectedItem(null);
            setCatalogSearch("");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Price Line</DialogTitle>
          </DialogHeader>

          {/* Mode toggle */}
          <div className="flex rounded-md border overflow-hidden w-full">
            <button
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors ${addLineMode === "catalog" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover-elevate"}`}
              onClick={() => {
                setAddLineMode("catalog");
                setCatalogSelectedItem(null);
                setCatalogSearch("");
                setNewLine({
                  articleCode: "",
                  productName: "",
                  quantity: newLine.quantity,
                  pricePerBale: newLine.pricePerBale,
                });
              }}
              data-testid="button-mode-catalog"
            >
              <BookOpen className="h-4 w-4" />
              From Catalog
            </button>
            <button
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors ${addLineMode === "manual" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover-elevate"}`}
              onClick={() => {
                setAddLineMode("manual");
                setCatalogSelectedItem(null);
                setNewLine({ articleCode: "", productName: "", quantity: "", pricePerBale: "" });
              }}
              data-testid="button-mode-manual"
            >
              <PenLine className="h-4 w-4" />
              Manual Entry
            </button>
          </div>

          <div className="space-y-4 py-1">
            {addLineMode === "catalog" ? (
              <>
                {/* Item picker */}
                {!catalogSelectedItem ? (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by name or article code..."
                        value={catalogSearch}
                        onChange={(e) => setCatalogSearch(e.target.value)}
                        className="pl-8"
                        autoFocus
                        data-testid="input-catalog-search"
                      />
                    </div>
                    <div className="border rounded-md overflow-hidden max-h-64 overflow-y-auto">
                      {allStockItems.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">Loading items...</p>
                      ) : (
                        (() => {
                          const q = catalogSearch.toLowerCase().trim();
                          const filtered = q
                            ? allStockItems.filter(
                                (item: any) =>
                                  item.name?.toLowerCase().includes(q) || item.code?.toLowerCase().includes(q)
                              )
                            : allStockItems;
                          if (filtered.length === 0)
                            return (
                              <p className="text-sm text-muted-foreground text-center py-6">
                                No items match "{catalogSearch}"
                              </p>
                            );
                          return filtered.map((item: any) => (
                            <button
                              key={item.id}
                              className="w-full flex items-center justify-between px-3 py-2.5 text-left hover-elevate border-b last:border-b-0"
                              onClick={() => {
                                setCatalogSelectedItem(item);
                                setNewLine((prev) => ({
                                  ...prev,
                                  articleCode: item.code || "",
                                  productName: item.name || "",
                                  pricePerBale: item.code && priceListMap[item.code] ? priceListMap[item.code] : "",
                                }));
                              }}
                              data-testid={`button-catalog-item-${item.id}`}
                            >
                              <div>
                                <p className="text-sm font-medium">{item.name}</p>
                                {item.code && <p className="text-xs text-muted-foreground font-mono">{item.code}</p>}
                              </div>
                              <div className="flex items-center gap-2 ml-2 shrink-0">
                                {item.code && priceListMap[item.code] && (
                                  <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                    ${parseFloat(priceListMap[item.code]).toFixed(2)}
                                  </span>
                                )}
                                {item.stockGroup?.name && (
                                  <span className="text-xs text-muted-foreground">{item.stockGroup.name}</span>
                                )}
                              </div>
                            </button>
                          ));
                        })()
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{allStockItems.length} items in catalog</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Selected item chip with change button */}
                    <div className="flex items-center gap-2 p-3 rounded-md bg-muted">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{catalogSelectedItem.name}</p>
                        {catalogSelectedItem.code && (
                          <p className="text-xs text-muted-foreground font-mono">{catalogSelectedItem.code}</p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setCatalogSelectedItem(null);
                          setCatalogSearch("");
                          setNewLine((prev) => ({
                            ...prev,
                            articleCode: "",
                            productName: "",
                            quantity: "",
                            pricePerBale: "",
                          }));
                        }}
                        data-testid="button-change-item"
                      >
                        Change
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-1 block">Quantity</label>
                        <Input
                          type="number"
                          placeholder="e.g. 10"
                          value={newLine.quantity}
                          onChange={(e) => setNewLine({ ...newLine, quantity: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault();
                          }}
                          autoFocus
                          data-testid="input-line-quantity"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">Price per Bale</label>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="e.g. 45.00"
                          value={newLine.pricePerBale}
                          onChange={(e) => setNewLine({ ...newLine, pricePerBale: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault();
                          }}
                          data-testid="input-line-price"
                        />
                        {catalogSelectedItem?.code && priceListMap[catalogSelectedItem.code] && (
                          <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                            Auto-filled from price list — you can override
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* Manual mode — existing form */
              <>
                <div>
                  <label className="text-sm font-medium mb-1 block">Article Code</label>
                  <Input
                    placeholder="e.g. 101"
                    value={newLine.articleCode}
                    onChange={(e) => setNewLine({ ...newLine, articleCode: e.target.value })}
                    data-testid="input-line-article-code"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Product Name</label>
                  <Input
                    placeholder="e.g. Mixed Cotton"
                    value={newLine.productName}
                    onChange={(e) => setNewLine({ ...newLine, productName: e.target.value })}
                    data-testid="input-line-product-name"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Quantity</label>
                    <Input
                      type="number"
                      value={newLine.quantity}
                      onChange={(e) => setNewLine({ ...newLine, quantity: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault();
                      }}
                      data-testid="input-line-quantity"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Price per Bale</label>
                    <Input
                      type="number"
                      step="0.01"
                      value={newLine.pricePerBale}
                      onChange={(e) => setNewLine({ ...newLine, pricePerBale: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault();
                      }}
                      data-testid="input-line-price"
                    />
                  </div>
                </div>
              </>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setIsAddLineOpen(false)} data-testid="button-cancel-add-line">
                Cancel
              </Button>
              <Button
                onClick={handleAddLine}
                disabled={
                  !newLine.articleCode ||
                  !newLine.productName ||
                  !newLine.quantity ||
                  !newLine.pricePerBale ||
                  addLineMutation.isPending ||
                  (addLineMode === "catalog" && !catalogSelectedItem)
                }
                data-testid="button-confirm-add-line"
              >
                {addLineMutation.isPending ? "Adding..." : "Add Line"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingLine} onOpenChange={(open) => !open && setEditingLine(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Price Line</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-muted p-3 rounded-md mb-2">
              <p className="text-sm font-semibold">{editingLine?.articleCode}</p>
              <p className="text-xs text-muted-foreground">{editingLine?.productName}</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Product Name</label>
              <Input
                value={editLineValues.productName}
                onChange={(e) => setEditLineValues({ ...editLineValues, productName: e.target.value })}
                data-testid="input-edit-line-product-name"
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Quantity</label>
                <Input
                  type="number"
                  value={editLineValues.quantity}
                  onChange={(e) => setEditLineValues({ ...editLineValues, quantity: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault();
                  }}
                  data-testid="input-edit-line-quantity"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Price per Bale</label>
                <Input
                  type="number"
                  step="0.01"
                  value={editLineValues.pricePerBale}
                  onChange={(e) => setEditLineValues({ ...editLineValues, pricePerBale: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault();
                  }}
                  data-testid="input-edit-line-price"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">KG / Bale</label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 97"
                  value={editLineValues.weightPerBaleKg}
                  onChange={(e) => setEditLineValues({ ...editLineValues, weightPerBaleKg: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault();
                  }}
                  data-testid="input-edit-line-weight"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setEditingLine(null)} data-testid="button-cancel-edit-line">
                Cancel
              </Button>
              <Button
                onClick={handleEditLine}
                disabled={!editLineValues.pricePerBale || !editLineValues.quantity || editLineMutation.isPending}
                data-testid="button-confirm-edit-line"
              >
                Save Changes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!createLoadingProforma}
        onOpenChange={(open) => {
          if (!open) {
            setCreateLoadingProforma(null);
            setCreateLoadingLocationId("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Pending Loading</DialogTitle>
            <DialogDescription>
              A new loading will be created from <strong>{createLoadingProforma?.name}</strong>. Bales matching each
              proforma line will be automatically reserved from the selected location.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-sm font-medium mb-1 block">Warehouse Location</Label>
              <Select value={createLoadingLocationId} onValueChange={setCreateLoadingLocationId}>
                <SelectTrigger data-testid="select-loading-location">
                  <SelectValue placeholder="Select a location..." />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id.toString()} data-testid={`select-location-option-${loc.id}`}>
                      {loc.name} {loc.code ? `(${loc.code})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateLoadingProforma(null);
                setCreateLoadingLocationId("");
              }}
              data-testid="button-cancel-create-loading"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!createLoadingProforma || !createLoadingLocationId) return;
                createLoadingMutation.mutate({
                  proformaId: createLoadingProforma.id,
                  locationId: createLoadingLocationId,
                });
              }}
              disabled={!createLoadingLocationId || createLoadingMutation.isPending}
              data-testid="button-confirm-create-loading"
            >
              {createLoadingMutation.isPending ? "Creating..." : "Create Loading"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Excel Import Dialog ──────────────────────────────────────────── */}
      <Dialog
        open={isExcelImportOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsExcelImportOpen(false);
            setExcelImportLines([]);
            setExcelImportErrors([]);
            if (excelFileInputRef.current) excelFileInputRef.current.value = "";
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Import Proforma from Excel</DialogTitle>
            <DialogDescription>
              Upload an Excel file (.xlsx) with columns: <strong>Article Code</strong>, <strong>Product Name</strong>,{" "}
              <strong>Quantity</strong>, <strong>Price Per Bale</strong>. Column names are flexible — any common
              variation is detected automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
            {/* Customer info */}
            <div className="flex items-center gap-2 p-3 rounded-md bg-muted">
              <div>
                <p className="text-xs text-muted-foreground">Customer</p>
                <p className="text-sm font-medium">
                  {customers.find((c: Customer) => c.id === customerId)?.legalName ?? "—"}
                </p>
              </div>
            </div>

            {/* Proforma name */}
            <div>
              <Label className="text-sm font-medium mb-1 block">Proforma Name</Label>
              <Input
                placeholder="e.g. Summer 2024 Pricing"
                value={excelImportName}
                onChange={(e) => setExcelImportName(e.target.value)}
                data-testid="input-excel-import-name"
              />
            </div>

            {/* File upload */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-sm font-medium">Excel File (.xlsx)</Label>
                <button
                  type="button"
                  onClick={downloadProformaTemplate}
                  className="text-xs text-primary underline-offset-2 hover:underline flex items-center gap-1"
                  data-testid="button-download-template"
                >
                  <Download className="h-3 w-3" />
                  Download template
                </button>
              </div>
              <div
                className="border-2 border-dashed rounded-md p-6 text-center cursor-pointer hover-elevate transition-colors"
                onClick={() => excelFileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file) handleExcelFile(file);
                }}
                data-testid="dropzone-excel-import"
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {excelImportLoading ? "Reading file…" : "Click or drag & drop an Excel file here"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Supports .xlsx format</p>
              </div>
              <input
                ref={excelFileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleExcelFile(f);
                }}
                data-testid="input-file-excel"
              />
            </div>

            {/* Parse errors */}
            {excelImportErrors.length > 0 && (
              <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 space-y-1">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                  <p className="text-sm font-medium text-destructive">
                    {excelImportLines.length > 0 ? "Some rows were skipped:" : "Could not parse file:"}
                  </p>
                </div>
                {excelImportErrors.map((err, i) => (
                  <p key={i} className="text-xs text-muted-foreground pl-6">
                    {err}
                  </p>
                ))}
              </div>
            )}

            {/* Preview table */}
            {excelImportLines.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2">
                  Preview — {excelImportLines.length} row{excelImportLines.length !== 1 ? "s" : ""} ready to import
                </p>
                <div className="border rounded-md overflow-hidden">
                  <div className="overflow-x-auto max-h-64 overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 z-30 bg-background">
                        <TableRow>
                          <TableHead className="text-xs">Article Code</TableHead>
                          <TableHead className="text-xs">Product Name</TableHead>
                          <TableHead className="text-xs text-right">Qty</TableHead>
                          <TableHead className="text-xs text-right">Price/Bale</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {excelImportLines.map((row, i) => (
                          <TableRow key={i} data-testid={`row-excel-preview-${i}`}>
                            <TableCell className="font-mono text-xs py-1.5">{row.articleCode}</TableCell>
                            <TableCell className="text-xs py-1.5">{row.productName}</TableCell>
                            <TableCell className="text-right font-mono text-xs py-1.5">{row.quantity}</TableCell>
                            <TableCell className="text-right font-mono text-xs py-1.5">
                              {parseFloat(row.pricePerBale) > 0 ? parseFloat(row.pricePerBale).toFixed(2) : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => {
                setIsExcelImportOpen(false);
                setExcelImportLines([]);
                setExcelImportErrors([]);
                if (excelFileInputRef.current) excelFileInputRef.current.value = "";
              }}
              data-testid="button-cancel-excel-import"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!customerId || !excelImportName.trim() || excelImportLines.length === 0) return;
                bulkImportMutation.mutate({
                  customerId,
                  name: excelImportName.trim(),
                  isActive: false,
                  lines: excelImportLines,
                });
              }}
              disabled={!excelImportName.trim() || excelImportLines.length === 0 || bulkImportMutation.isPending}
              data-testid="button-confirm-excel-import"
            >
              {bulkImportMutation.isPending ? "Creating…" : `Create Proforma (${excelImportLines.length} lines)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onConfirm={() => {
          pendingDelete?.();
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
