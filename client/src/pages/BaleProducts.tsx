import { useState, useRef, useEffect } from "react";
import { DeleteConfirmDialog } from "@/components/ConfirmationDialog";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Package, Upload, Download, ChevronDown, ChevronRight, LayoutGrid, List, Tags, Pencil, Trash2, X, AlertTriangle, FileSpreadsheet, EyeOff, Eye, AlertCircle, Palette, Search } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { A4_DESIGN_OPTIONS } from "@/lib/labelHtml";
import { CreateBaleProductDialog } from "../components/CreateBaleProductDialog";
import { AdminAuthDialog } from "@/components/AdminAuthDialog";
import type { FactoryBaleProduct, FactoryCategory } from "@shared/schema";

const hmdLogoPath = "/hmd-logo-export.png";

interface ImportPreviewRow {
  articleCode: string;
  name: string;
  category?: string;
  description?: string;
  weightPerBaleKg?: string;
  productionPrice?: number | string;
  sellingPrice?: number | string;
  active?: boolean;
}

interface GroupedProduct {
  articleCode: string;
  name: string;
  count: number;
  items: FactoryBaleProduct[];
}

export default function BaleProducts() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [adminAuthOpen, setAdminAuthOpen] = useState(false);
  const [pendingAdminAuth, setPendingAdminAuth] = useState<{ username: string; password: string } | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreviewRow[]>([]);
  const [importError, setImportError] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [condensedView, setCondensedView] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showCategories, setShowCategories] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set());
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategory, setEditingCategory] = useState<{ id: number; name: string } | null>(null);
  const [editingProduct, setEditingProduct] = useState<FactoryBaleProduct | null>(null);
  const [editForm, setEditForm] = useState({ name: "", articleCode: "", weightPerBaleKg: "", categoryId: "", description: "", grade: "", productionPrice: "", sellingPrice: "", labelDesignColor: "" });
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<(() => void) | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [showZeroPrice, setShowZeroPrice] = useState(false);
  const [showNoColor, setShowNoColor] = useState(false);
  const [filterCategoryId, setFilterCategoryId] = useState<number | null>(null);
  const [filterWeight, setFilterWeight] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);

  useEffect(() => {
    if (editingProduct) {
      setEditForm({
        name: editingProduct.name || "",
        articleCode: editingProduct.articleCode || "",
        weightPerBaleKg: editingProduct.weightPerBaleKg ? String(editingProduct.weightPerBaleKg) : "",
        categoryId: editingProduct.categoryId ? String(editingProduct.categoryId) : "",
        description: editingProduct.description || "",
        grade: "",
        productionPrice: editingProduct.productionPrice && parseFloat(editingProduct.productionPrice) > 0 ? String(parseFloat(editingProduct.productionPrice)) : "",
        sellingPrice: editingProduct.sellingPrice && parseFloat(editingProduct.sellingPrice) > 0 ? String(parseFloat(editingProduct.sellingPrice)) : "",
        labelDesignColor: editingProduct.labelDesignColor || "",
      });
    }
  }, [editingProduct]);

  const { data: currentUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isAdmin = ["Admin", "Owner", "Developer"].includes(currentUser?.role || "");

  const { data: myAccess } = useQuery<{ hiddenCostFields: string[] }>({
    queryKey: ["/api/factory/my-access"],
  });
  const { data: factorySettingsData } = useQuery<{ hideAvgCost?: boolean; hideSellingPrice?: boolean }>({
    queryKey: ["/api/factory/settings"],
    queryFn: async () => { const res = await fetch("/api/factory/settings", { credentials: "include" }); return res.ok ? res.json() : {}; },
  });
  const perUserHiddenBP = myAccess?.hiddenCostFields ?? [];
  const hideAvgRate = perUserHiddenBP.includes("inventory_avg_rate") || perUserHiddenBP.includes("inventory_total_value") || !!factorySettingsData?.hideAvgCost || perUserHiddenBP.includes("hide_export_cost_price");
  const hideSellingPriceBP = !!factorySettingsData?.hideSellingPrice || perUserHiddenBP.includes("inventory_sell_price") || perUserHiddenBP.includes("inventory_sell_value") || perUserHiddenBP.includes("hide_export_selling_price");

  const { data: products, isLoading } = useQuery<FactoryBaleProduct[]>({
    queryKey: ["/api/factory/bale-products"],
  });

  const { data: categories } = useQuery<FactoryCategory[]>({
    queryKey: ["/api/factory/categories"],
  });

  const categoryMap = new Map<number, string>();
  categories?.forEach((c) => categoryMap.set(c.id, c.name));

  const allActiveProducts = products?.filter((p) => p.active !== false);
  const noColorCount = allActiveProducts?.filter((p) => !p.labelDesignColor).length ?? 0;
  const distinctWeights = Array.from(
    new Set((allActiveProducts ?? []).map((p) => p.weightPerBaleKg).filter(Boolean) as string[])
  ).sort((a, b) => parseFloat(a) - parseFloat(b));
  const searchLower = searchQuery.trim().toLowerCase();
  const activeProducts = allActiveProducts
    ?.filter((p) => !showZeroPrice || parseFloat(p.sellingPrice || "0") === 0)
    ?.filter((p) => !showNoColor || !p.labelDesignColor)
    ?.filter((p) => filterCategoryId === null || p.categoryId === filterCategoryId)
    ?.filter((p) => filterWeight === null || String(p.weightPerBaleKg) === filterWeight)
    ?.filter((p) =>
      !searchLower ||
      (p.articleCode ?? "").toLowerCase().includes(searchLower) ||
      (p.name ?? "").toLowerCase().includes(searchLower)
    );
  const hiddenProducts = products?.filter((p) => p.active === false);

  const toggleSelectId = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (list: FactoryBaleProduct[]) => {
    const ids = list.map((p) => p.id);
    const allSelected = ids.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds((prev) => { const next = new Set(prev); ids.forEach((id) => next.delete(id)); return next; });
    } else {
      setSelectedIds((prev) => { const next = new Set(prev); ids.forEach((id) => next.add(id)); return next; });
    }
  };

  const selectedActiveIds = Array.from(selectedIds).filter((id) => activeProducts?.some((p) => p.id === id));
  const selectedHiddenIds = Array.from(selectedIds).filter((id) => hiddenProducts?.some((p) => p.id === id));

  const createCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await modeApiRequest("POST", "/api/factory/categories", { name });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/categories"] });
      setNewCategoryName("");
      toast({ title: "Category created" });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      const response = await modeApiRequest("PATCH", `/api/factory/categories/${id}`, { name });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/categories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });
      setEditingCategory(null);
      toast({ title: "Category updated" });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await modeApiRequest("DELETE", `/api/factory/categories/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/categories"] });
      toast({ title: "Category deleted" });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/factory/bale-products/import-excel", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Import failed");
      }
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/categories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/location-inventory"], exact: false });

      const cols = result.detectedColumns || {};
      const detectedInfo = [
        cols.articleCode ? `Article Code: "${cols.articleCode}"` : null,
        cols.productionPrice ? `Cost Price: "${cols.productionPrice}"` : null,
        cols.sellingPrice ? `Sell Price: "${cols.sellingPrice}"` : null,
      ].filter(Boolean).join(", ");

      const noPriceColsFound = !cols.productionPrice && !cols.sellingPrice;
      const allSkipped = result.skippedNoArticleCode > 0 && (result.created + result.updated) === 0;

      if (allSkipped || !cols.articleCode) {
        toast({
          title: "Import Warning",
          description: `No products were matched — article code column not found. Your file must have a column named "Article Code". Columns seen: ${Object.keys(result.detectedColumns || {}).filter(k => result.detectedColumns[k]).map((k: string) => `"${result.detectedColumns[k]}"`).join(", ") || "none detected"}`,
          variant: "destructive",
        });
      } else if (noPriceColsFound) {
        toast({
          title: "Import Complete — No Prices Updated",
          description: `${result.updated || 0} updated, ${result.created || 0} created. Column detected: ${detectedInfo}. No price columns found — add "Production Price" and/or "Selling Price" columns to your file.`,
          variant: "destructive",
        });
      } else {
        const parts = [];
        if (result.created) parts.push(`${result.created} created`);
        if (result.updated) parts.push(`${result.updated} updated`);
        if (result.pricesUpdated) parts.push(`${result.pricesUpdated} with prices`);
        if (result.categoriesCreated) parts.push(`${result.categoriesCreated} categories auto-created`);
        toast({
          title: "Import Complete",
          description: (parts.join(", ") || "0 products processed") + (detectedInfo ? ` | Columns: ${detectedInfo}` : ""),
        });
      }

      setImportDialogOpen(false);
      setImportPreview([]);
      setImportFile(null);
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Import Error", description: error.message, variant: "destructive" });
    },
  });

  const editProductMutation = useMutation({
    mutationFn: async (data: { name: string; weightPerBaleKg: number | null; articleCode: string; description: string; categoryId: number | null; labelDesignColor: string | null; productionPrice: string; sellingPrice: string }) => {
      const response = await modeApiRequest("POST", `/api/factory/bale-products/${editingProduct!.id}/cascade-update`, data);
      return response.json();
    },
    onSuccess: (result: { product: FactoryBaleProduct; balesUpdated: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/location-inventory"], exact: false });
      setEditingProduct(null);
      toast({
        title: "Product updated",
        description: `${result.balesUpdated} bale(s) also updated`,
      });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const colorUpdateMutation = useMutation({
    mutationFn: async ({ id, labelDesignColor }: { id: number; labelDesignColor: string | null }) => {
      const response = await modeApiRequest("POST", `/api/factory/bale-products/${id}/cascade-update`, { labelDesignColor });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteProductMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await modeApiRequest("DELETE", `/api/factory/bale-products/${id}`);
      if (!response.ok) throw new Error("Failed to delete product");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });
      setEditingProduct(null);
      toast({ title: "Product deleted", description: "The product has been removed." });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const bulkToggleActiveMutation = useMutation({
    mutationFn: async ({ ids, active }: { ids: number[]; active: boolean }) => {
      const response = await modeApiRequest("POST", "/api/factory/bale-products/bulk-toggle-active", { ids, active });
      if (!response.ok) throw new Error("Failed to update products");
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });
      setSelectedIds(new Set());
      toast({ title: variables.active ? "Products unhidden" : "Products hidden", description: `${variables.ids.length} product(s) updated.` });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleGradeChange = async (grade: string) => {
    setEditForm(f => ({ ...f, grade }));
    if (!grade) return;
    setIsGeneratingCode(true);
    try {
      const response = await modeApiRequest("GET", `/api/factory/bale-products/generate-code?grade=${encodeURIComponent(grade)}`);
      const data = await response.json();
      if (data.articleCode) setEditForm(f => ({ ...f, articleCode: data.articleCode }));
    } catch {
      toast({ title: "Error", description: "Could not generate article code", variant: "destructive" });
    } finally {
      setIsGeneratingCode(false);
    }
  };

  const handleEditSubmit = () => {
    if (!editForm.name.trim()) return;
    editProductMutation.mutate({
      name: editForm.name.trim(),
      articleCode: editForm.articleCode.trim(),
      weightPerBaleKg: editForm.weightPerBaleKg ? parseFloat(editForm.weightPerBaleKg) : null,
      categoryId: editForm.categoryId ? parseInt(editForm.categoryId) : null,
      description: editForm.description.trim(),
      productionPrice: editForm.productionPrice,
      sellingPrice: editForm.sellingPrice,
      labelDesignColor: editForm.labelDesignColor || null,
    });
  };

  const handleExportExcel = async (priceType: "selling" | "production") => {
    if (priceType === "selling" && hideSellingPriceBP) {
      toast({ title: "Selling price is hidden for your account", variant: "destructive" });
      return;
    }
    if (priceType === "production" && hideAvgRate) {
      toast({ title: "Production price is hidden for your account", variant: "destructive" });
      return;
    }
    if (!activeProducts || activeProducts.length === 0) {
      toast({ title: "No products to export", variant: "destructive" });
      return;
    }
    try {
      const ExcelJSModule = await import("exceljs");
      const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;

      const priceHeader = priceType === "selling" ? "Selling Price" : "Production Price";
      const today = new Date().toISOString().slice(0, 10);
      const fileName = priceType === "selling"
        ? "HMD_Order_Selling_Price.xlsx"
        : "HMD_Order_Production_Price.xlsx";

      // ── Brand colours ────────────────────────────────────────────────
      const C_NAVY    = "FF00205B";
      const C_BLUE    = "FF1F3A6B";
      const C_ACCENT  = "FF2E75B6";
      const C_ALT_ROW = "FFDCE6F1";
      const C_WHITE   = "FFFFFFFF";
      const C_BORDER  = "FFBFBFBF";
      const C_MUTED   = "FF888888";
      const C_ZERO    = "FFBBBBBB";
      const C_TOTAL   = "FFE8F0F8";
      const C_TOTAL_LABEL = "FF00205B";

      const wb = new (ExcelJS as any).Workbook();
      wb.creator = "HMD International Group";
      const ws = wb.addWorksheet("Make Your Order");

      // ── Column definitions ──────────────────────────────────────────
      // A=#, B=Article(hidden), C=Name, D=Category, E=Weight, F=Price, G=Bales, H=Total
      ws.columns = [
        { key: "num",      width: 6   },
        { key: "article",  width: 18, hidden: true },
        { key: "name",     width: 42  },
        { key: "category", width: 22  },
        { key: "weight",   width: 14  },
        { key: "price",    width: 16  },
        { key: "bales",    width: 12  },
        { key: "total",    width: 18  },
      ];

      // ── Logo ─────────────────────────────────────────────────────────
      try {
        const logoRes = await fetch(hmdLogoPath);
        const logoBuffer = await logoRes.arrayBuffer();
        const imageId = wb.addImage({ buffer: logoBuffer, extension: "png" });
        ws.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: 180, height: 72 } });
      } catch { /* logo fetch failed — skip */ }

      // ── Header rows 1-4 ─────────────────────────────────────────────
      const addHeaderRow = (text: string, height: number, font: any) => {
        const r = ws.addRow(["", "", text, "", "", "", "", ""]);
        r.height = height;
        const cell = r.getCell(3);
        cell.font = font;
        cell.alignment = { vertical: "middle", horizontal: "left" };
        ws.mergeCells(`C${r.number}:H${r.number}`);
        return r;
      };

      addHeaderRow("HMD International Group", 24,
        { bold: true, size: 16, color: { argb: C_NAVY } });
      addHeaderRow(`Make Your Order – ${priceHeader}`, 20,
        { bold: true, size: 12, color: { argb: C_ACCENT } });
      addHeaderRow(`Enter quantities in the "Bales" column`, 16,
        { size: 10, color: { argb: C_MUTED } });
      addHeaderRow(`Generated: ${today}`, 16,
        { size: 10, color: { argb: C_MUTED } });

      // Row 5 – navy accent spacer
      const spacer = ws.addRow(["", "", "", "", "", "", "", ""]);
      spacer.height = 6;
      ws.mergeCells(`A${spacer.number}:H${spacer.number}`);
      spacer.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_NAVY } };

      // ── Table header row 6 ───────────────────────────────────────────
      const hdrRow = ws.addRow(["#", "Article Code", "Name of Item", "Category", "Weight (kg)", priceHeader, "Bales", "Total"]);
      hdrRow.height = 22;
      hdrRow.eachCell((cell: any) => {
        cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: C_BLUE } };
        cell.font      = { bold: true, color: { argb: C_WHITE }, size: 11 };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border    = {
          top:    { style: "thin",   color: { argb: C_BLUE } },
          bottom: { style: "medium", color: { argb: C_NAVY } },
          left:   { style: "thin",   color: { argb: C_BLUE } },
          right:  { style: "thin",   color: { argb: C_BLUE } },
        };
      });

      // ── Data rows (start at row 7) ───────────────────────────────────
      const DATA_START = 7;
      activeProducts.forEach((p, i) => {
        const rawPrice = priceType === "selling" ? p.sellingPrice : p.productionPrice;
        const numPrice = rawPrice ? parseFloat(rawPrice) : 0;
        const categoryName = p.categoryId ? (categoryMap.get(p.categoryId) || "") : "";
        const weight = p.weightPerBaleKg != null ? parseFloat(String(p.weightPerBaleKg)) : "";
        const rowNum = DATA_START + i;

        const row = ws.addRow([
          `#${i + 1}`,
          p.articleCode || "",
          p.name || "",
          categoryName,
          weight,
          numPrice,
          "",                             // Bales — blank for user input
          { formula: `=F${rowNum}*G${rowNum}`, result: 0 }, // Total = Price × Bales
        ]);
        row.height = 18;

        const isAlt = i % 2 === 1;
        const rowFill = isAlt
          ? { type: "pattern", pattern: "solid", fgColor: { argb: C_ALT_ROW } }
          : undefined;

        row.eachCell((cell: any, colNum: number) => {
          if (rowFill) cell.fill = rowFill;
          cell.font = { size: 10 };
          cell.border = { bottom: { style: "hair", color: { argb: C_BORDER } } };
          if (colNum === 1)                 cell.alignment = { horizontal: "center" };
          if (colNum === 5 || colNum === 6) cell.alignment = { horizontal: "right" };
          if (colNum === 7)                 cell.alignment = { horizontal: "center" };
          if (colNum === 8)                 cell.alignment = { horizontal: "right" };
        });

        const priceCell = row.getCell(6);
        priceCell.numFmt = "#,##0.00";
        if (numPrice === 0) priceCell.font = { size: 10, color: { argb: C_ZERO } };
        if (weight !== "") row.getCell(5).numFmt = "#,##0.##";

        // Total column format
        row.getCell(8).numFmt = "#,##0.00";
      });

      // ── Total row ────────────────────────────────────────────────────
      const lastDataRow = DATA_START + activeProducts.length - 1;
      const totalRow = ws.addRow([
        "",
        "",
        "TOTAL ORDER",
        "",
        "",
        "",
        { formula: `=SUM(G${DATA_START}:G${lastDataRow})`, result: 0 },
        { formula: `=SUM(H${DATA_START}:H${lastDataRow})`, result: 0 },
      ]);
      totalRow.height = 22;
      const totalFill = { type: "pattern", pattern: "solid", fgColor: { argb: C_TOTAL } };
      totalRow.eachCell((cell: any, colNum: number) => {
        cell.fill   = totalFill;
        cell.border = {
          top:    { style: "medium", color: { argb: C_NAVY } },
          bottom: { style: "medium", color: { argb: C_NAVY } },
        };
      });
      const labelCell = totalRow.getCell(3);
      labelCell.font      = { bold: true, size: 11, color: { argb: C_TOTAL_LABEL } };
      labelCell.alignment = { horizontal: "left", vertical: "middle" };
      ws.mergeCells(`C${totalRow.number}:F${totalRow.number}`);

      const balesTotal = totalRow.getCell(7);
      balesTotal.font      = { bold: true, size: 12, color: { argb: C_NAVY } };
      balesTotal.numFmt    = "#,##0";
      balesTotal.alignment = { horizontal: "center", vertical: "middle" };

      const grandTotal = totalRow.getCell(8);
      grandTotal.font      = { bold: true, size: 12, color: { argb: C_NAVY } };
      grandTotal.numFmt    = "#,##0.00";
      grandTotal.alignment = { horizontal: "right", vertical: "middle" };

      // ── Freeze & auto-filter ─────────────────────────────────────────
      ws.views = [{ state: "frozen", xSplit: 0, ySplit: 6 }];
      ws.autoFilter = { from: "A6", to: `H${lastDataRow}` };

      // ── Download ─────────────────────────────────────────────────────
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);

      toast({ title: `Order sheet downloaded — ${priceHeader}` });
    } catch (err) {
      console.error("Export failed", err);
      toast({ title: "Export failed", variant: "destructive" });
    }
  };

  const handleExportNoPrices = async () => {
    if (!activeProducts || activeProducts.length === 0) {
      toast({ title: "No products to export", variant: "destructive" });
      return;
    }
    try {
      const ExcelJSModule = await import("exceljs");
      const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;

      const today = new Date().toISOString().slice(0, 10);

      const C_NAVY    = "FF00205B";
      const C_BLUE    = "FF1F3A6B";
      const C_ACCENT  = "FF2E75B6";
      const C_ALT_ROW = "FFDCE6F1";
      const C_WHITE   = "FFFFFFFF";
      const C_BORDER  = "FFBFBFBF";
      const C_MUTED   = "FF888888";
      const C_TOTAL   = "FFE8F0F8";

      const wb = new (ExcelJS as any).Workbook();
      wb.creator = "HMD International Group";
      const ws = wb.addWorksheet("Make Your Order");

      // A=#, B=Article(hidden), C=Name, D=Category, E=Weight, F=Bales
      ws.columns = [
        { key: "num",      width: 6   },
        { key: "article",  width: 18, hidden: true },
        { key: "name",     width: 48  },
        { key: "category", width: 22  },
        { key: "weight",   width: 14  },
        { key: "bales",    width: 14  },
      ];

      // ── Logo ─────────────────────────────────────────────────────────
      try {
        const logoRes = await fetch(hmdLogoPath);
        const logoBuffer = await logoRes.arrayBuffer();
        const imageId = wb.addImage({ buffer: logoBuffer, extension: "png" });
        ws.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: 180, height: 72 } });
      } catch { /* logo fetch failed — skip */ }

      const addHeaderRow = (text: string, height: number, font: any) => {
        const r = ws.addRow(["", "", text, "", "", ""]);
        r.height = height;
        const cell = r.getCell(3);
        cell.font = font;
        cell.alignment = { vertical: "middle", horizontal: "left" };
        ws.mergeCells(`C${r.number}:F${r.number}`);
        return r;
      };

      addHeaderRow("HMD International Group", 24,
        { bold: true, size: 16, color: { argb: C_NAVY } });
      addHeaderRow("Make Your Order", 20,
        { bold: true, size: 12, color: { argb: C_ACCENT } });
      addHeaderRow(`Enter quantities in the "Bales" column`, 16,
        { size: 10, color: { argb: C_MUTED } });
      addHeaderRow(`Generated: ${today}`, 16,
        { size: 10, color: { argb: C_MUTED } });

      const spacer = ws.addRow(["", "", "", "", "", ""]);
      spacer.height = 6;
      ws.mergeCells(`A${spacer.number}:F${spacer.number}`);
      spacer.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_NAVY } };

      const hdrRow = ws.addRow(["#", "Article Code", "Name of Item", "Category", "Weight (kg)", "Bales"]);
      hdrRow.height = 22;
      hdrRow.eachCell((cell: any) => {
        cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: C_BLUE } };
        cell.font      = { bold: true, color: { argb: C_WHITE }, size: 11 };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border    = {
          top:    { style: "thin",   color: { argb: C_BLUE } },
          bottom: { style: "medium", color: { argb: C_NAVY } },
          left:   { style: "thin",   color: { argb: C_BLUE } },
          right:  { style: "thin",   color: { argb: C_BLUE } },
        };
      });

      const DATA_START = 7;
      activeProducts.forEach((p, i) => {
        const categoryName = p.categoryId ? (categoryMap.get(p.categoryId) || "") : "";
        const weight = p.weightPerBaleKg != null ? parseFloat(String(p.weightPerBaleKg)) : "";

        const row = ws.addRow([
          `#${i + 1}`,
          p.articleCode || "",
          p.name || "",
          categoryName,
          weight,
          "",   // Bales — blank for user input
        ]);
        row.height = 18;

        const isAlt = i % 2 === 1;
        const rowFill = isAlt
          ? { type: "pattern", pattern: "solid", fgColor: { argb: C_ALT_ROW } }
          : undefined;

        row.eachCell((cell: any, colNum: number) => {
          if (rowFill) cell.fill = rowFill;
          cell.font = { size: 10 };
          cell.border = { bottom: { style: "hair", color: { argb: C_BORDER } } };
          if (colNum === 1)  cell.alignment = { horizontal: "center" };
          if (colNum === 5)  cell.alignment = { horizontal: "right" };
          if (colNum === 6)  cell.alignment = { horizontal: "center" };
        });
        if (weight !== "") row.getCell(5).numFmt = "#,##0.##";
      });

      // ── Total row ────────────────────────────────────────────────────
      const lastDataRow = DATA_START + activeProducts.length - 1;
      const totalRow = ws.addRow([
        "", "",
        "TOTAL ORDER",
        "", "",
        { formula: `=SUM(F${DATA_START}:F${lastDataRow})`, result: 0 },
      ]);
      totalRow.height = 22;
      const totalFill = { type: "pattern", pattern: "solid", fgColor: { argb: C_TOTAL } };
      totalRow.eachCell((cell: any) => {
        cell.fill   = totalFill;
        cell.border = {
          top:    { style: "medium", color: { argb: C_NAVY } },
          bottom: { style: "medium", color: { argb: C_NAVY } },
        };
      });
      ws.mergeCells(`C${totalRow.number}:E${totalRow.number}`);
      const labelCell = totalRow.getCell(3);
      labelCell.font      = { bold: true, size: 11, color: { argb: C_NAVY } };
      labelCell.alignment = { horizontal: "left", vertical: "middle" };

      const balesTotal = totalRow.getCell(6);
      balesTotal.font      = { bold: true, size: 12, color: { argb: C_NAVY } };
      balesTotal.numFmt    = "#,##0";
      balesTotal.alignment = { horizontal: "center", vertical: "middle" };

      ws.views = [{ state: "frozen", xSplit: 0, ySplit: 6 }];
      ws.autoFilter = { from: "A6", to: `F${lastDataRow}` };

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "HMD_Order_No_Prices.xlsx";
      a.click();
      URL.revokeObjectURL(url);

      toast({ title: "Order sheet (no prices) downloaded" });
    } catch (err) {
      console.error("Export failed", err);
      toast({ title: "Export failed", variant: "destructive" });
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const XLSX = await import("@/lib/excelHelper");
      const templateData = [
        {
          "Article Code": "HMD01000",
          Name: "Sample Product 1",
          Category: "Category A",
          "Weight Per Bale": "45",
          "Production Price": "100.00",
          "Selling Price": "120.00",
        },
        {
          "Article Code": "HMD02000",
          Name: "Sample Product 2",
          Category: "Category B",
          "Weight Per Bale": "50",
          "Production Price": "80.00",
          "Selling Price": "100.00",
        },
      ];
      const ws = XLSX.utils.json_to_sheet(templateData);
      ws["!cols"] = [
        { wch: 15 },
        { wch: 25 },
        { wch: 20 },
        { wch: 16 },
        { wch: 18 },
        { wch: 18 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Bale Products");
      await XLSX.writeFile(wb, "bale_products_template.xlsx");
      toast({ title: "Template downloaded" });
    } catch (err: any) {
      toast({ title: "Error", description: "Failed to generate template", variant: "destructive" });
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError("");
    setImportPreview([]);
    setImportFile(file);

    try {
      const XLSX = await import("@/lib/excelHelper");
      const buffer = await file.arrayBuffer();
      const workbook = await XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows: any[] = XLSX.utils.sheet_to_json(worksheet);

      if (rows.length === 0) {
        setImportError("Excel file is empty");
        setImportFile(null);
        return;
      }

      const preview: ImportPreviewRow[] = rows.map((row) => {
        const itemNumber = row.itemNumber || row.item_number || row.ItemNumber;
        let articleCode = (
          row["Article Code"] || row.articleCode || row.article_code || row.ArticleCode || ""
        ).toString().trim();
        if (!articleCode && itemNumber) {
          const num = parseInt(String(itemNumber));
          if (!isNaN(num) && num >= 1 && num <= 99) {
            articleCode = `HMD${String(num).padStart(2, "0")}000`;
          }
        }
        const rawProdPrice = row["Production Price"] ?? row["production price"] ?? row.productionPrice ?? row.production_price ?? row["Cost Price"] ?? row.costPrice ?? null;
        const rawSellPrice = row["Selling Price"] ?? row["selling price"] ?? row.sellingPrice ?? row.selling_price ?? null;
        return {
          articleCode: articleCode || "",
          name: (row["Name"] || row.name || row.Name || row["Product Name"] || row.product_name || "").toString().trim(),
          category: (row.category || row.Category || row.category_name || "").toString().trim(),
          description: (row.description || row.Description || "").toString().trim(),
          weightPerBaleKg: (row["Weight Per Bale"] || row.weightPerBaleKg || row.weight_per_bale_kg || row.weight || "").toString() || undefined,
          productionPrice: rawProdPrice !== null && rawProdPrice !== "" ? parseFloat(String(rawProdPrice)) || undefined : undefined,
          sellingPrice: rawSellPrice !== null && rawSellPrice !== "" ? parseFloat(String(rawSellPrice)) || undefined : undefined,
          active: row.active === undefined ? true : Boolean(row.active),
        };
      });

      const missing = preview.filter((r) => !r.articleCode || !r.name);
      if (missing.length > 0) {
        setImportError(`${missing.length} row(s) missing required Article Code or Name`);
      }

      setImportPreview(preview.filter((r) => r.articleCode && r.name));
      setImportDialogOpen(true);
    } catch (err: any) {
      setImportError(err.message || "Failed to parse Excel file");
      setImportFile(null);
      toast({ title: "Parse Error", description: err.message, variant: "destructive" });
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleConfirmImport = () => {
    if (!importFile) {
      toast({ title: "No file", description: "Please select a file first", variant: "destructive" });
      return;
    }
    importMutation.mutate(importFile);
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const groupedProducts: (GroupedProduct & { _key: string })[] = (() => {
    if (!activeProducts) return [];
    const groups: Record<string, GroupedProduct & { _key: string }> = {};
    for (const p of activeProducts) {
      const key = p.articleCode || p.code;
      if (!groups[key]) {
        groups[key] = { _key: key, articleCode: p.articleCode || "", name: p.name, count: 0, items: [] };
      }
      groups[key].count++;
      groups[key].items.push(p);
    }
    return Object.values(groups).sort((a, b) => (a.items[0]?.id ?? 0) - (b.items[0]?.id ?? 0));
  })();

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <PageHeader title="Bale Products" subtitle="Manage product types for bale production" />
        </div>
        <div className="flex gap-2 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            onChange={handleFileSelect}
            data-testid="input-import-file"
          />
          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" data-testid="button-actions-menu">
                  Actions
                  <ChevronDown className="h-3 w-3 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="text-xs text-muted-foreground">Categories</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setShowCategories(!showCategories)} data-testid="menu-manage-categories">
                  <Tags className="h-4 w-4 mr-2" />
                  {showCategories ? "Hide Categories" : "Manage Categories"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">Make Your Order</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => handleExportExcel("selling")} data-testid="menu-export-selling-price">
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Selling Price
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExportExcel("production")} data-testid="menu-export-production-price">
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Production Price
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportNoPrices} data-testid="menu-export-no-prices">
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  No Prices
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">Import / Template</DropdownMenuLabel>
                <DropdownMenuItem onClick={handleDownloadTemplate} data-testid="menu-download-template">
                  <Download className="h-4 w-4 mr-2" />
                  Download Template
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => fileInputRef.current?.click()} data-testid="menu-import-excel">
                  <Upload className="h-4 w-4 mr-2" />
                  Import Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            onClick={() => {
              if (isAdmin) {
                setCreateDialogOpen(true);
              } else {
                setAdminAuthOpen(true);
              }
            }}
            data-testid="button-create-product"
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Product
          </Button>
        </div>
      </div>

      {showCategories && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tags className="h-5 w-5" />
              Product Categories
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="New category name..."
                data-testid="input-new-category"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newCategoryName.trim()) {
                    createCategoryMutation.mutate(newCategoryName.trim());
                  }
                }}
              />
              <Button
                onClick={() => {
                  if (newCategoryName.trim()) createCategoryMutation.mutate(newCategoryName.trim());
                }}
                disabled={!newCategoryName.trim() || createCategoryMutation.isPending}
                data-testid="button-add-category"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add
              </Button>
            </div>
            {categories && categories.length > 0 ? (
              <div className="space-y-1">
                {categories.map((cat) => {
                  const catProducts = (products ?? []).filter((p) => p.categoryId === cat.id);
                  const isExpanded = expandedCategories.has(cat.id);
                  return (
                    <div key={cat.id} className="rounded-md border overflow-hidden">
                      {/* Category header row */}
                      <div className="flex items-center justify-between gap-2 p-2 bg-muted/30">
                        {editingCategory?.id === cat.id ? (
                          <div className="flex items-center gap-2 flex-1">
                            <Input
                              value={editingCategory.name}
                              onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                              data-testid={`input-edit-category-${cat.id}`}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && editingCategory.name.trim()) {
                                  updateCategoryMutation.mutate({ id: cat.id, name: editingCategory.name.trim() });
                                }
                                if (e.key === "Escape") setEditingCategory(null);
                              }}
                            />
                            <Button
                              size="sm"
                              onClick={() => updateCategoryMutation.mutate({ id: cat.id, name: editingCategory.name.trim() })}
                              disabled={!editingCategory.name.trim()}
                              data-testid={`button-save-category-${cat.id}`}
                            >
                              Save
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => setEditingCategory(null)}>
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <button
                              className="flex items-center gap-2 flex-1 text-left min-w-0"
                              onClick={() => setExpandedCategories((prev) => {
                                const next = new Set(prev);
                                if (next.has(cat.id)) next.delete(cat.id); else next.add(cat.id);
                                return next;
                              })}
                              data-testid={`button-expand-category-${cat.id}`}
                            >
                              {isExpanded
                                ? <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                                : <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />}
                              <span className="font-medium" data-testid={`text-category-${cat.id}`}>{cat.name}</span>
                              {!cat.isActive && <Badge variant="outline">Inactive</Badge>}
                              <span className="text-xs text-muted-foreground ml-1">({catProducts.length})</span>
                            </button>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setEditingCategory({ id: cat.id, name: cat.name })}
                                data-testid={`button-edit-category-${cat.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setPendingDelete(() => () => deleteCategoryMutation.mutate(cat.id))}
                                data-testid={`button-delete-category-${cat.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Expanded products list */}
                      {isExpanded && (
                        <div className="border-t">
                          {catProducts.length === 0 ? (
                            <p className="text-xs text-muted-foreground px-4 py-2">No products in this category.</p>
                          ) : (
                            <table className="w-full text-sm">
                              <thead className="sticky top-0 z-30 bg-muted/50">
                                <tr className="border-b bg-muted/10">
                                  <th className="text-left px-4 py-1.5 text-xs font-medium text-muted-foreground">Code</th>
                                  <th className="text-left px-4 py-1.5 text-xs font-medium text-muted-foreground">Name</th>
                                  {!hideAvgRate && <th className="text-right px-4 py-1.5 text-xs font-medium text-muted-foreground">Prod. Price</th>}
                                  {!hideSellingPriceBP && <th className="text-right px-4 py-1.5 text-xs font-medium text-muted-foreground">Sell Price</th>}
                                  <th className="text-right px-4 py-1.5 text-xs font-medium text-muted-foreground">Wt/Bale</th>
                                </tr>
                              </thead>
                              <tbody>
                                {catProducts.map((p) => (
                                  <tr key={p.id} className="border-b last:border-0 hover-elevate" data-testid={`row-cat-product-${p.id}`}>
                                    <td className="px-4 py-1.5 font-mono text-xs text-muted-foreground">{p.articleCode}</td>
                                    <td className="px-4 py-1.5 font-medium">
                                      {p.name}
                                      {p.active === false && <Badge variant="outline" className="ml-2 text-xs">Hidden</Badge>}
                                    </td>
                                    {!hideAvgRate && (
                                      <td className="px-4 py-1.5 text-right tabular-nums text-xs">
                                        {parseFloat(p.productionPrice || "0") > 0 ? `$${parseFloat(p.productionPrice!).toFixed(2)}` : <span className="text-muted-foreground">—</span>}
                                      </td>
                                    )}
                                    {!hideSellingPriceBP && (
                                      <td className="px-4 py-1.5 text-right tabular-nums text-xs">
                                        {parseFloat(p.sellingPrice || "0") > 0 ? `$${parseFloat(p.sellingPrice!).toFixed(2)}` : <span className="text-muted-foreground">—</span>}
                                      </td>
                                    )}
                                    <td className="px-4 py-1.5 text-right tabular-nums text-xs text-muted-foreground">
                                      {p.weightPerBaleKg ? `${p.weightPerBaleKg} kg` : "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No categories yet. Create one above.</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <CardTitle>Product List</CardTitle>
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
                  {selectedActiveIds.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => bulkToggleActiveMutation.mutate({ ids: selectedActiveIds, active: false })}
                      disabled={bulkToggleActiveMutation.isPending}
                      data-testid="button-bulk-hide"
                    >
                      <EyeOff className="h-4 w-4 mr-1" />
                      Hide {selectedActiveIds.length > 0 ? `(${selectedActiveIds.length})` : ""}
                    </Button>
                  )}
                  {selectedHiddenIds.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => bulkToggleActiveMutation.mutate({ ids: selectedHiddenIds, active: true })}
                      disabled={bulkToggleActiveMutation.isPending}
                      data-testid="button-bulk-unhide"
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      Unhide {selectedHiddenIds.length > 0 ? `(${selectedHiddenIds.length})` : ""}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} data-testid="button-clear-selection">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setSelectedIds(new Set()); }}
                  placeholder="Search by name or code..."
                  className="pl-8 w-56"
                  data-testid="input-search-products"
                />
                {searchQuery && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => { setSearchQuery(""); setSelectedIds(new Set()); }}
                    data-testid="button-clear-search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {categories && categories.length > 0 && (
                <Select
                  value={filterCategoryId === null ? "all" : String(filterCategoryId)}
                  onValueChange={(val) => { setFilterCategoryId(val === "all" ? null : Number(val)); setSelectedIds(new Set()); }}
                >
                  <SelectTrigger className="w-44" data-testid="select-filter-category">
                    <SelectValue placeholder="All categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={String(cat.id)}>{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {distinctWeights.length > 0 && (
                <Select
                  value={filterWeight === null ? "all" : filterWeight}
                  onValueChange={(val) => { setFilterWeight(val === "all" ? null : val); setSelectedIds(new Set()); }}
                >
                  <SelectTrigger className="w-36" data-testid="select-filter-weight">
                    <SelectValue placeholder="All weights" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All weights</SelectItem>
                    {distinctWeights.map((w) => (
                      <SelectItem key={w} value={w}>{w} kg</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {/* Filters dropdown */}
              {(() => {
                const activeFilterCount = (showZeroPrice && !hideSellingPriceBP ? 1 : 0) + (showNoColor && noColorCount > 0 ? 1 : 0) + (showHidden && hiddenProducts && hiddenProducts.length > 0 ? 1 : 0);
                const hasAnyFilter = (!hideSellingPriceBP) || (noColorCount > 0) || (hiddenProducts && hiddenProducts.length > 0);
                if (!hasAnyFilter) return null;
                return (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant={activeFilterCount > 0 ? "default" : "outline"} data-testid="button-filters-dropdown">
                        <AlertCircle className="h-4 w-4 mr-1.5" />
                        Filters
                        {activeFilterCount > 0 && (
                          <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-xs no-default-active-elevate">{activeFilterCount}</Badge>
                        )}
                        <ChevronDown className="h-3 w-3 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuLabel className="text-xs text-muted-foreground">Show in list</DropdownMenuLabel>
                      {!hideSellingPriceBP && (
                        <DropdownMenuItem
                          onClick={() => { setShowZeroPrice(v => !v); setSelectedIds(new Set()); }}
                          data-testid="menu-filter-unpriced"
                          className="flex items-center justify-between"
                        >
                          <span className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-muted-foreground" />
                            Unpriced products
                          </span>
                          {showZeroPrice && <span className="text-xs text-primary font-medium">On</span>}
                        </DropdownMenuItem>
                      )}
                      {noColorCount > 0 && (
                        <DropdownMenuItem
                          onClick={() => { setShowNoColor(v => !v); setSelectedIds(new Set()); }}
                          data-testid="menu-filter-no-color"
                          className="flex items-center justify-between"
                        >
                          <span className="flex items-center gap-2">
                            <Palette className="h-4 w-4 text-muted-foreground" />
                            No color ({noColorCount})
                          </span>
                          {showNoColor && <span className="text-xs text-primary font-medium">On</span>}
                        </DropdownMenuItem>
                      )}
                      {hiddenProducts && hiddenProducts.length > 0 && (
                        <DropdownMenuItem
                          onClick={() => { setShowHidden(!showHidden); setSelectedIds(new Set()); }}
                          data-testid="menu-filter-hidden"
                          className="flex items-center justify-between"
                        >
                          <span className="flex items-center gap-2">
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                            Hidden products ({hiddenProducts.length})
                          </span>
                          {showHidden && <span className="text-xs text-primary font-medium">On</span>}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              })()}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : condensedView ? (
            groupedProducts.length > 0 ? (
              <Table wrapperClassName="overflow-visible">
                <TableHeader className="sticky top-0 z-30 bg-background">
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Article Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Wt/Bale (kg)</TableHead>
                    {!hideAvgRate && <TableHead className="text-right">Prod. Price</TableHead>}
                    {!hideSellingPriceBP && <TableHead className="text-right">Sell Price</TableHead>}
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="w-[60px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupedProducts.map((group) => (
                    <>
                      <TableRow
                        key={group._key}
                        className="cursor-pointer hover-elevate"
                        onClick={() => toggleGroup(group._key)}
                        data-testid={`row-group-${group._key}`}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={group.items.length > 0 && group.items.every((p) => selectedIds.has(p.id))}
                            onCheckedChange={() => toggleSelectAll(group.items)}
                          />
                        </TableCell>
                        <TableCell>
                          {expandedGroups.has(group._key) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </TableCell>
                        <TableCell className="font-mono font-medium">{group.articleCode || "-"}</TableCell>
                        <TableCell className="font-medium">{group.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {group.items[0]?.categoryId ? categoryMap.get(group.items[0].categoryId) || "-" : "-"}
                        </TableCell>
                        {!hideAvgRate && <TableCell></TableCell>}
                        {!hideSellingPriceBP && <TableCell></TableCell>}
                        <TableCell className="text-right">
                          <Badge variant="secondary">{group.count}</Badge>
                        </TableCell>
                      </TableRow>
                      {expandedGroups.has(group._key) &&
                        group.items.map((product) => (
                          <TableRow key={product.id} className={`bg-muted/30 ${selectedIds.has(product.id) ? "bg-muted/60" : ""}`} data-testid={`row-product-${product.id}`}>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selectedIds.has(product.id)}
                                onCheckedChange={() => toggleSelectId(product.id)}
                                data-testid={`checkbox-product-${product.id}`}
                              />
                            </TableCell>
                            <TableCell></TableCell>
                            <TableCell className="font-mono text-muted-foreground text-sm pl-8">
                              {product.articleCode || "-"}
                            </TableCell>
                            <TableCell className="text-sm">
                              <div className="flex items-center gap-2">
                                <span>{product.name}</span>
                                {isAdmin && (
                                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                    <button
                                      title="No color"
                                      onClick={() => colorUpdateMutation.mutate({ id: product.id, labelDesignColor: null })}
                                      className={`w-5 h-5 rounded-full border border-border flex items-center justify-center transition-all ${!product.labelDesignColor ? "ring-1 ring-offset-1 ring-primary" : "opacity-50 hover:opacity-100"}`}
                                      data-testid={`button-color-none-${product.id}`}
                                    >
                                      <X className="w-3 h-3 text-muted-foreground" />
                                    </button>
                                    {A4_DESIGN_OPTIONS.map((opt) => (
                                      <button
                                        key={opt.value}
                                        title={opt.label}
                                        onClick={() => colorUpdateMutation.mutate({ id: product.id, labelDesignColor: opt.value })}
                                        className={`w-5 h-5 rounded-full border transition-all ${product.labelDesignColor === opt.value ? "ring-1 ring-offset-1 ring-primary opacity-100" : "opacity-50 hover:opacity-100"}`}
                                        style={{ backgroundColor: opt.color, borderColor: opt.color === "#F5F5F5" ? "#ccc" : opt.color }}
                                        data-testid={`button-color-${opt.value}-${product.id}`}
                                      />
                                    ))}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {product.categoryId ? categoryMap.get(product.categoryId) || "-" : "-"}
                            </TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">
                              {product.weightPerBaleKg ? `${product.weightPerBaleKg} kg` : "-"}
                            </TableCell>
                            {!hideAvgRate && (
                              <TableCell className="text-right text-sm font-mono text-muted-foreground">
                                {product.productionPrice && parseFloat(product.productionPrice) > 0 ? parseFloat(product.productionPrice).toLocaleString() : "—"}
                              </TableCell>
                            )}
                            {!hideSellingPriceBP && (
                              <TableCell className="text-right text-sm font-mono text-muted-foreground">
                                {product.sellingPrice && parseFloat(product.sellingPrice) > 0 ? parseFloat(product.sellingPrice).toLocaleString() : "—"}
                              </TableCell>
                            )}
                            <TableCell></TableCell>
                            <TableCell>
                              {isAdmin && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={(e) => { e.stopPropagation(); setEditingProduct(product); }}
                                  data-testid={`button-edit-product-${product.id}`}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                    </>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState onCreateClick={() => setCreateDialogOpen(true)} />
            )
          ) : activeProducts && activeProducts.length > 0 ? (
            <Table wrapperClassName="overflow-visible">
              <TableHeader className="sticky top-0 z-30 bg-background">
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={activeProducts.length > 0 && activeProducts.every((p) => selectedIds.has(p.id))}
                      onCheckedChange={() => toggleSelectAll(activeProducts)}
                      data-testid="checkbox-select-all"
                    />
                  </TableHead>
                  <TableHead>Article Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Weight/Bale (kg)</TableHead>
                  {!hideAvgRate && <TableHead className="text-right">Prod. Price</TableHead>}
                  {!hideSellingPriceBP && <TableHead className="text-right">Sell Price</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[60px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeProducts.map((product) => (
                  <TableRow key={product.id} data-testid={`row-product-${product.id}`} className={selectedIds.has(product.id) ? "bg-muted/50" : ""}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(product.id)}
                        onCheckedChange={() => toggleSelectId(product.id)}
                        data-testid={`checkbox-product-${product.id}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono font-medium">{product.articleCode || "-"}</TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span>{product.name}</span>
                        {isAdmin && (
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              title="No color"
                              onClick={() => colorUpdateMutation.mutate({ id: product.id, labelDesignColor: null })}
                              className={`w-5 h-5 rounded-full border border-border flex items-center justify-center transition-all ${!product.labelDesignColor ? "ring-1 ring-offset-1 ring-primary" : "opacity-50 hover:opacity-100"}`}
                              data-testid={`button-color-none-${product.id}`}
                            >
                              <X className="w-3 h-3 text-muted-foreground" />
                            </button>
                            {A4_DESIGN_OPTIONS.map((opt) => (
                              <button
                                key={opt.value}
                                title={opt.label}
                                onClick={() => colorUpdateMutation.mutate({ id: product.id, labelDesignColor: opt.value })}
                                className={`w-5 h-5 rounded-full border transition-all ${product.labelDesignColor === opt.value ? "ring-1 ring-offset-1 ring-primary opacity-100" : "opacity-50 hover:opacity-100"}`}
                                style={{ backgroundColor: opt.color, borderColor: opt.color === "#F5F5F5" ? "#ccc" : opt.color }}
                                data-testid={`button-color-${opt.value}-${product.id}`}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {product.categoryId ? categoryMap.get(product.categoryId) || "Uncategorized" : "Uncategorized"}
                    </TableCell>
                    <TableCell className="text-right font-mono">{product.weightPerBaleKg || "-"}</TableCell>
                    {!hideAvgRate && (
                      <TableCell className="text-right font-mono">
                        {product.productionPrice && parseFloat(product.productionPrice) > 0 ? parseFloat(product.productionPrice).toLocaleString() : "—"}
                      </TableCell>
                    )}
                    {!hideSellingPriceBP && (
                      <TableCell className="text-right font-mono">
                        {product.sellingPrice && parseFloat(product.sellingPrice) > 0 ? parseFloat(product.sellingPrice).toLocaleString() : "—"}
                      </TableCell>
                    )}
                    <TableCell>
                      <Badge variant={product.active ? "secondary" : "outline"}>
                        {product.active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {isAdmin && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setEditingProduct(product)}
                          data-testid={`button-edit-product-${product.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState onCreateClick={() => setCreateDialogOpen(true)} />
          )}

          {showHidden && hiddenProducts && hiddenProducts.length > 0 && (
            <div className="mt-6 border-t pt-4">
              <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <EyeOff className="h-4 w-4" />
                Hidden Products ({hiddenProducts.length})
              </h3>
              <Table wrapperClassName="overflow-visible">
                <TableHeader className="sticky top-0 z-30 bg-background">
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox
                        checked={hiddenProducts.length > 0 && hiddenProducts.every((p) => selectedIds.has(p.id))}
                        onCheckedChange={() => toggleSelectAll(hiddenProducts)}
                        data-testid="checkbox-select-all-hidden"
                      />
                    </TableHead>
                    <TableHead>Article Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="w-[100px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hiddenProducts.map((product) => (
                    <TableRow key={product.id} className={selectedIds.has(product.id) ? "bg-muted/50" : ""} data-testid={`row-hidden-product-${product.id}`}>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(product.id)}
                          onCheckedChange={() => toggleSelectId(product.id)}
                          data-testid={`checkbox-hidden-product-${product.id}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-muted-foreground">{product.articleCode || "-"}</TableCell>
                      <TableCell className="text-muted-foreground">{product.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {product.categoryId ? categoryMap.get(product.categoryId) || "-" : "-"}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => bulkToggleActiveMutation.mutate({ ids: [product.id], active: true })}
                          disabled={bulkToggleActiveMutation.isPending}
                          data-testid={`button-unhide-product-${product.id}`}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          Unhide
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateBaleProductDialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (!open) setPendingAdminAuth(null);
        }}
        adminAuth={pendingAdminAuth}
      />

      <AdminAuthDialog
        open={adminAuthOpen}
        onOpenChange={(open) => {
          setAdminAuthOpen(open);
        }}
        action="create a new bale product"
        onAuthorized={(credentials) => {
          setPendingAdminAuth(credentials);
          setAdminAuthOpen(false);
          setCreateDialogOpen(true);
        }}
      />

      <Dialog open={!!editingProduct} onOpenChange={(open) => { if (!open) setEditingProduct(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Product</DialogTitle>
            <DialogDescription>
              Update product details. Changes will cascade to related bales.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name *</Label>
              <Input
                id="edit-name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                required
                data-testid="input-edit-product-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-articleCode">Article Code</Label>
              <Input
                id="edit-articleCode"
                value={editForm.articleCode}
                onChange={(e) => setEditForm({ ...editForm, articleCode: e.target.value })}
                className="font-mono"
                data-testid="input-edit-product-articleCode"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-weight">Weight per Bale (KG)</Label>
              <Input
                id="edit-weight"
                type="number"
                value={editForm.weightPerBaleKg}
                onChange={(e) => setEditForm({ ...editForm, weightPerBaleKg: e.target.value })}
                data-testid="input-edit-product-weight"
              />
            </div>
            {(!hideAvgRate || !hideSellingPriceBP) && (
              <div className="grid grid-cols-2 gap-3">
                {!hideAvgRate && (
                  <div className="space-y-2">
                    <Label htmlFor="edit-productionPrice">Cost Price</Label>
                    <Input
                      id="edit-productionPrice"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={editForm.productionPrice}
                      onChange={(e) => setEditForm({ ...editForm, productionPrice: e.target.value })}
                      data-testid="input-edit-product-production-price"
                    />
                  </div>
                )}
                {!hideSellingPriceBP && (
                  <div className="space-y-2">
                    <Label htmlFor="edit-sellingPrice">Sell Price</Label>
                    <Input
                      id="edit-sellingPrice"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={editForm.sellingPrice}
                      onChange={(e) => setEditForm({ ...editForm, sellingPrice: e.target.value })}
                      data-testid="input-edit-product-selling-price"
                    />
                  </div>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={editForm.categoryId}
                onValueChange={(val) => setEditForm({ ...editForm, categoryId: val })}
              >
                <SelectTrigger data-testid="select-edit-product-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories?.map((cat) => (
                    <SelectItem key={cat.id} value={String(cat.id)}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                data-testid="input-edit-product-description"
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Palette className="h-3.5 w-3.5" />
                Label Design Color
              </Label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="button-label-color-none"
                  onClick={() => setEditForm({ ...editForm, labelDesignColor: "" })}
                  className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${!editForm.labelDesignColor ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover-elevate"}`}
                >
                  No Design
                </button>
                {A4_DESIGN_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    data-testid={`button-label-color-${opt.value}`}
                    onClick={() => setEditForm({ ...editForm, labelDesignColor: opt.value })}
                    className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${editForm.labelDesignColor === opt.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover-elevate"}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {editForm.labelDesignColor && (
                <p className="text-xs text-muted-foreground">
                  Labels for this product will print with the <span className="font-medium">{A4_DESIGN_OPTIONS.find(o => o.value === editForm.labelDesignColor)?.label}</span> design automatically.
                </p>
              )}
              {!editForm.labelDesignColor && (
                <p className="text-xs text-muted-foreground">
                  Labels will print with no design banner.
                </p>
              )}
            </div>
            <div className="flex items-start gap-2 p-3 rounded-md bg-muted text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Changes to name, weight, and article code will also update all existing bales using this product.</span>
            </div>
            <div className="flex justify-between gap-2">
              <Button
                variant="destructive"
                onClick={() => {
                  setPendingDelete(() => () => deleteProductMutation.mutate(editingProduct!.id));
                }}
                disabled={deleteProductMutation.isPending}
                data-testid="button-delete-edit-product"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                {deleteProductMutation.isPending ? "Deleting..." : "Delete"}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setEditingProduct(null)} data-testid="button-cancel-edit-product">
                  Cancel
                </Button>
                <Button
                  onClick={handleEditSubmit}
                  disabled={!editForm.name.trim() || editProductMutation.isPending}
                  data-testid="button-save-edit-product"
                >
                  {editProductMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Preview</DialogTitle>
            <DialogDescription>
              Review the {importPreview.length} product(s) to import. Existing products (by Article Code) will be updated.
            </DialogDescription>
          </DialogHeader>

          {importError && (
            <div className="text-destructive text-sm p-2 rounded-md bg-destructive/10">{importError}</div>
          )}

          <Table>
            <TableHeader className="sticky top-0 z-30 bg-background">
              <TableRow>
                <TableHead>Article Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Weight/Bale</TableHead>
                <TableHead>Cost Price</TableHead>
                <TableHead>Sell Price</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {importPreview.map((row, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-mono font-medium">{row.articleCode}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-muted-foreground">{row.category || "Uncategorized"}</TableCell>
                  <TableCell>{row.weightPerBaleKg || "-"}</TableCell>
                  <TableCell>{row.productionPrice != null ? Number(row.productionPrice).toLocaleString() : "-"}</TableCell>
                  <TableCell>{row.sellingPrice != null ? Number(row.sellingPrice).toLocaleString() : "-"}</TableCell>
                  <TableCell className="text-muted-foreground">{row.description || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setImportDialogOpen(false); setImportFile(null); setImportPreview([]); }} data-testid="button-cancel-import">
              Cancel
            </Button>
            <Button
              onClick={handleConfirmImport}
              disabled={importMutation.isPending || importPreview.length === 0}
              data-testid="button-confirm-import"
            >
              {importMutation.isPending ? "Importing..." : `Import ${importPreview.length} Products`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <DeleteConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        onConfirm={() => { pendingDelete?.(); setPendingDelete(null); }}
      />
    </div>
  );
}

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="text-center py-12">
      <Package className="mx-auto h-12 w-12 text-muted-foreground" />
      <h3 className="mt-4 text-lg font-semibold">No products found</h3>
      <p className="text-muted-foreground mt-2">Create your first product to get started</p>
      <Button className="mt-4" onClick={onCreateClick}>
        <Plus className="h-4 w-4 mr-2" />
        Create Product
      </Button>
    </div>
  );
}
