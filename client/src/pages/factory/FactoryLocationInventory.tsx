import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { apiRequest } from "@/lib/queryClient";
import { queryClient, keyStartsWith } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/PageHeader";
import {
  MapPin, Layers, Package, Search, Printer, ArrowUpDown,
  FileText, ClipboardList, X, Download, FileSpreadsheet, Plus, Check, Trash2, Pencil, Tag, Zap, Eye,
  AlertTriangle
} from "lucide-react";
import { useReactToPrint } from "react-to-print";
import { useEscapeBack } from "@/hooks/use-escape-back";
import { isZebraMode, printRawZpl } from "@/lib/zebraPrint";
import { buildZplBatch } from "@/lib/zplBuilder";
import { getPaperFormat } from "@/components/LabelPrintSettings";
import { generateCombinedLabelsHtml, generateA5LabelsHtml, generateStickerLabelsHtml, A4_DESIGN_OPTIONS, type LabelData, type A4DesignColor } from "@/lib/labelHtml";

type SortField = "name" | "bales" | "kg" | "value";
type SortDir = "asc" | "desc";

interface Location {
  id: number;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
}

interface FactoryBaleProduct {
  productId: number;
  articleCode: string;
  productName: string;
  category: string | null;
  categoryId: number | null;
  quantity: number;
  totalWeight: number;
  totalCost: number;
  baleCount: number;
  loadingCount?: number;
  sellingPrice: string;
  productionPrice: number;
  reservedQty?: number;
  availableQty?: number;
  reservations?: Array<{ proformaId: number; proformaName: string; customerId: number; qty: number }>;
  isInactive?: boolean;
}

interface CategoryGroup {
  categoryId: number | null;
  categoryName: string;
  baleCount: number;
  totalWeight: number;
  totalCost: number;
  totalSellValue: number;
  productCount: number;
  products: FactoryBaleProduct[];
}

interface ProformaSelection {
  productId: number;
  articleCode: string;
  productName: string;
  availableBales: number;
  totalWeight: number;
  selectedQty: number;
  pricePerBale: string;
}

interface Customer {
  id: number;
  legalName: string;
  balance: number;
  balanceSide: string;
}

function applySortProducts(items: FactoryBaleProduct[], field: SortField, dir: SortDir) {
  return [...items].sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case "name": cmp = a.productName.localeCompare(b.productName); break;
      case "bales": cmp = a.baleCount - b.baleCount; break;
      case "kg": cmp = a.totalWeight - b.totalWeight; break;
      case "value": cmp = (a.baleCount * parseFloat(a.sellingPrice || "0")) - (b.baleCount * parseFloat(b.sellingPrice || "0")); break;
    }
    return dir === "desc" ? -cmp : cmp;
  });
}

const SPECIAL_FACTORY_CATS = ["Wipers", "Garbage"];
function isSpecialFactoryCategory(name: string) {
  return SPECIAL_FACTORY_CATS.some((s) => s.toLowerCase() === name.trim().toLowerCase());
}

export default function FactoryLocationInventory() {
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [locationSearch, setLocationSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("__all__");
  const [productSearch, setProductSearch] = useState("");
  const [prodSortField, setProdSortField] = useState<SortField>("name");
  const [prodSortDir, setProdSortDir] = useState<SortDir>("asc");
  const [_loc, navigate] = useLocation();
  const printRef = useRef<HTMLDivElement>(null);
  const { formatAmount } = useCurrencyContext();
  const { toast } = useToast();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);

  const [proformaMode, setProformaMode] = useState(false);
  const [showZeroStock, setShowZeroStock] = useState(false);
  const [hideZeroAvailable, setHideZeroAvailable] = useState(true);
  const [selections, setSelections] = useState<Map<number, ProformaSelection>>(new Map());
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [proformaAutoSave, setProformaAutoSave] = useState<boolean>(() => {
    try { return localStorage.getItem("proforma-inventory-autosave") === "true"; } catch { return false; }
  });
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSilentAutoSaveRef = useRef(false);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [proformaName, setProformaName] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [savedProformaId, setSavedProformaId] = useState<number | null>(null);

  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renamingLocation, setRenamingLocation] = useState<Location | null>(null);
  const [renameInput, setRenameInput] = useState("");

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteProduct, setDeleteProduct] = useState<FactoryBaleProduct | null>(null);
  const [deleteQty, setDeleteQty] = useState(1);
  const [deleteSupervisorUser, setDeleteSupervisorUser] = useState("");
  const [deleteSupervisorPass, setDeleteSupervisorPass] = useState("");
  const [deleteReason, setDeleteReason] = useState("");

  const [reprintDialogOpen, setReprintDialogOpen] = useState(false);
  const [reprintProduct, setReprintProduct] = useState<FactoryBaleProduct | null>(null);
  const [reprintBales, setReprintBales] = useState<any[]>([]);
  const [reprintLoading, setReprintLoading] = useState(false);
  const [reprintDesignPickerOpen, setReprintDesignPickerOpen] = useState(false);
  const [reprintPendingLabels, setReprintPendingLabels] = useState<LabelData[]>([]);

  const [editingProformaId, setEditingProformaId] = useState<number | null>(null);
  const [editProformaLines, setEditProformaLines] = useState<Array<{ articleCode: string; quantity: number; pricePerBale: string }>>([]);
  const [editModeInitialized, setEditModeInitialized] = useState(false);

  const [overloadWarning, setOverloadWarning] = useState<{
    open: boolean;
    items: Array<{ articleCode: string; productName: string; requested: number; available: number }>;
    pendingFn: (() => void) | null;
  }>({ open: false, items: [], pendingFn: null });

  const handlePrint = useReactToPrint({ contentRef: printRef });

  const openBrowserReprintLabels = (labels: LabelData[], designColor?: A4DesignColor) => {
    const fmt = getPaperFormat();
    if (fmt === "A4" && !designColor) {
      setReprintPendingLabels(labels);
      setReprintDesignPickerOpen(true);
      return;
    }
    const paperHtml = fmt === "A5"
      ? generateA5LabelsHtml(labels)
      : generateCombinedLabelsHtml(labels, designColor);
    const stickerHtml = generateStickerLabelsHtml(labels);

    const w1 = window.open("", "_blank", "width=800,height=900");
    if (w1) {
      w1.document.write(paperHtml);
      w1.document.close();
      w1.focus();
      setTimeout(() => w1.print(), 500);
    }
    const w2 = window.open("", "_blank", "width=400,height=600");
    if (w2) {
      w2.document.write(stickerHtml);
      w2.document.close();
      w2.focus();
      const imgs = w2.document.images;
      let loaded = 0;
      const total = imgs.length;
      const tryPrint = () => { loaded++; if (loaded >= total) setTimeout(() => w2.print(), 300); };
      if (total === 0) { setTimeout(() => w2.print(), 300); }
      else { for (let i = 0; i < total; i++) { if (imgs[i].complete) tryPrint(); else imgs[i].onload = imgs[i].onerror = tryPrint; } }
    }
    if (!w1 && !w2) {
      toast({ title: "Warning", description: "Please allow pop-ups to print labels", variant: "destructive" });
    }
  };

  const handleReprintProduct = async (prod: FactoryBaleProduct) => {
    if (!selectedLocation) return;
    setReprintProduct(prod);
    setReprintBales([]);
    setReprintLoading(true);
    setReprintDialogOpen(true);
    try {
      const res = await fetch(
        `/api/factory/bales?locationId=${selectedLocation.id}&productId=${prod.productId}&status=IN_STOCK`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch bales");
      const data = await res.json();
      setReprintBales(data);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setReprintDialogOpen(false);
    } finally {
      setReprintLoading(false);
    }
  };

  const handleDoPrint = async () => {
    if (reprintBales.length === 0) return;
    const labels: LabelData[] = reprintBales.map((row: any) => ({
      referenceNumber: row.bale.referenceNumber || row.bale.baleCode,
      articleCode: row.product?.articleCode || row.bale.articleCode || row.bale.category || "",
      pieces: row.bale.quantity || 1,
      approxWeightKg: row.bale.weightKg || "0",
      productName: row.bale.productName || row.product?.name || row.bale.category || "",
    }));

    for (const row of reprintBales) {
      try {
        await modeApiRequest("POST", "/api/bale-label-prints/reprint", { baleId: row.bale.id });
      } catch {}
    }

    setReprintDialogOpen(false);

    if (isZebraMode()) {
      try {
        const zpl = buildZplBatch(labels, true);
        await printRawZpl(zpl);
        toast({ title: `${labels.length} label(s) sent to Zebra printer` });
      } catch (err: any) {
        toast({ title: "Zebra print failed — falling back to browser", description: err.message, variant: "destructive" });
        openBrowserReprintLabels(labels);
      }
    } else {
      openBrowserReprintLabels(labels);
    }
  };

  const { data: locations = [], isLoading: locationsLoading } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: myAccess } = useQuery<{ fullAccess: boolean; pageKeys: string[]; hasErpAccess: boolean; hasFactoryAccess: boolean; hiddenCostFields: string[] }>({
    queryKey: ["/api/factory/my-access"],
  });

  const { data: factorySettingsData } = useQuery<{ hideSellingPrice?: boolean; hideAvgCost?: boolean }>({
    queryKey: ["/api/factory/settings"],
    queryFn: async () => {
      const res = await fetch("/api/factory/settings", { credentials: "include" });
      return res.ok ? res.json() : {};
    },
  });
  const perUserHidden = myAccess?.hiddenCostFields ?? [];
  const hideSellingPrice = !!factorySettingsData?.hideSellingPrice
    || perUserHidden.includes("inventory_sell_price")
    || perUserHidden.includes("inventory_sell_value")
    || perUserHidden.includes("hide_export_selling_price");
  const hideAvgCost = !!factorySettingsData?.hideAvgCost
    || perUserHidden.includes("inventory_avg_rate")
    || perUserHidden.includes("inventory_total_value")
    || perUserHidden.includes("hide_export_cost_price");

  const { data: inventoryData = [], isLoading: inventoryLoading } = useQuery<FactoryBaleProduct[]>({
    queryKey: selectedLocation
      ? [`/api/factory/location-inventory/${selectedLocation.id}`]
      : [],
    queryFn: async () => {
      const response = await fetch(`/api/factory/location-inventory/${selectedLocation!.id}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch factory inventory");
      return response.json();
    },
    enabled: !!selectedLocation,
  });

  const { data: availableInventoryData = [], isLoading: availableLoading } = useQuery<FactoryBaleProduct[]>({
    queryKey: selectedLocation
      ? [`/api/factory/location-inventory/${selectedLocation.id}/available`]
      : [],
    queryFn: async () => {
      const response = await fetch(`/api/factory/location-inventory/${selectedLocation!.id}/available`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch available inventory");
      return response.json();
    },
    enabled: !!selectedLocation && proformaMode,
  });

  const { data: catalogBaleProducts = [] } = useQuery<Array<{ id: number; articleCode: string | null; name: string; sellingPrice: string | null; productionPrice: string | null; categoryId: number | null; active: boolean }>>({
    queryKey: ["/api/factory/bale-products"],
    queryFn: async () => {
      const res = await fetch("/api/factory/bale-products", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch bale products catalog");
      return res.json();
    },
    enabled: proformaMode || showZeroStock,
  });

  const { data: catalogCategories = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["/api/factory/categories"],
    queryFn: async () => {
      const res = await fetch("/api/factory/categories", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch categories");
      return res.json();
    },
    enabled: proformaMode || showZeroStock,
  });

  const activeInventoryData: FactoryBaleProduct[] = useMemo(() => {
    const base = proformaMode && availableInventoryData.length > 0 ? availableInventoryData : inventoryData;
    const catNameMap = new Map(catalogCategories.map((c) => [c.id, c.name]));

    const shouldMergeZero = (!hideZeroAvailable && proformaMode) || (!proformaMode && showZeroStock);
    if (!shouldMergeZero) return base;

    const inStockIds = new Set(base.map((p) => p.productId));
    const zeroItems: FactoryBaleProduct[] = catalogBaleProducts
      .filter((p) => !inStockIds.has(p.id) && p.active !== false)
      .map((p) => ({
        productId: p.id,
        articleCode: p.articleCode || "",
        productName: p.name,
        category: p.categoryId ? (catNameMap.get(p.categoryId) ?? "Uncategorized") : "Uncategorized",
        categoryId: p.categoryId,
        quantity: 0,
        totalWeight: 0,
        totalCost: 0,
        baleCount: 0,
        sellingPrice: String(p.sellingPrice || "0"),
        productionPrice: parseFloat(p.productionPrice || "0"),
        isInactive: p.active === false,
      }));
    return [...base, ...zeroItems];
  }, [proformaMode, showZeroStock, hideZeroAvailable, availableInventoryData, inventoryData, catalogBaleProducts, catalogCategories]);

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/factory/customers"],
    enabled: finalizeOpen,
  });

  const createCustomerMutation = useMutation({
    mutationFn: async (data: { legalName: string }) => {
      return await modeApiRequest("POST", "/api/factory/customers", data);
    },
    onSuccess: (newCustomer: any) => {
      toast({ title: "Customer created" });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      setSelectedCustomerId(String(newCustomer.id));
      setShowCreateCustomer(false);
      setNewCustomerName("");
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const bulkCreateMutation = useMutation({
    mutationFn: async (data: { customerId: number; name: string; isActive: boolean; lines: any[] }) => {
      const res = await modeApiRequest("POST", "/api/factory/customer-proformas/bulk", data);
      return await res.json();
    },
    onSuccess: (result: any) => {
      setSavedProformaId(result.id);
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-proformas") });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/location-inventory"] });
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const replaceLinesMutation = useMutation({
    mutationFn: async (data: { id: number; lines: any[] }) => {
      const res = await modeApiRequest("PUT", `/api/factory/customer-proformas/${data.id}/replace-lines`, { lines: data.lines });
      return await res.json();
    },
    onSuccess: (result: any) => {
      const silent = isSilentAutoSaveRef.current;
      isSilentAutoSaveRef.current = false;
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-proformas") });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/location-inventory"] });
      setSavedProformaId(result.id);
      if (silent) {
        toast({ title: "Auto-saved", description: "Proforma saved automatically" });
      } else {
        toast({ title: "Proforma updated", description: "Lines saved successfully" });
        setTimeout(() => navigate("/factory/invoicing?tab=proformas"), 800);
      }
    },
    onError: (error: Error) => {
      isSilentAutoSaveRef.current = false;
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const removeBalesMutation = useMutation({
    mutationFn: async (data: { productId: number; locationId: number; qty: number; supervisorUsername: string; supervisorPassword: string; reason: string }) => {
      const res = await modeApiRequest("POST", "/api/factory/stock-entry/remove-by-product", data);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to remove bales");
      return json;
    },
    onSuccess: (result: any) => {
      toast({ title: "Removed", description: `${result.removed} bale(s) removed from stock.` });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/location-inventory/${selectedLocation?.id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      setDeleteDialogOpen(false);
      setDeleteProduct(null);
      setDeleteQty(1);
      setDeleteSupervisorUser("");
      setDeleteSupervisorPass("");
      setDeleteReason("");
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const renameLocationMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      const res = await apiRequest("PATCH", `/api/locations/${id}`, { name });
      return res.json();
    },
    onSuccess: (updated) => {
      toast({ title: "Location renamed", description: `Renamed to "${updated.name}".` });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      if (selectedLocation?.id === updated.id) {
        setSelectedLocation(updated);
      }
      setRenameDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const openRenameDialog = (loc: Location, e?: { stopPropagation: () => void }) => {
    e?.stopPropagation();
    setRenamingLocation(loc);
    setRenameInput(loc.name);
    setRenameDialogOpen(true);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const editId = params.get("editProformaId");
    const editName = params.get("editProformaName");
    const editCustId = params.get("editCustomerId");
    if (editId && editName && editCustId) {
      const proformaId = parseInt(editId);
      setEditingProformaId(proformaId);
      setProformaName(decodeURIComponent(editName));
      setSelectedCustomerId(editCustId);
      setProformaMode(true);
      fetch(`/api/factory/customer-proformas?customerId=${editCustId}`, { credentials: "include" })
        .then((r) => r.json())
        .then((proformas: any[]) => {
          const found = proformas.find((p: any) => p.id === proformaId);
          if (found?.lines?.length) {
            setEditProformaLines(found.lines.map((l: any) => ({
              articleCode: l.articleCode,
              quantity: l.quantity,
              pricePerBale: l.pricePerBale,
            })));
          }
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!editingProformaId || editProformaLines.length === 0 || !selectedLocation || inventoryLoading || editModeInitialized) return;
    const productByArticleCode = new Map<string, any>();
    (inventoryData as any[]).forEach((prod: any) => {
      productByArticleCode.set((prod.articleCode || "").toLowerCase(), prod);
    });
    const newSelections = new Map<number, ProformaSelection>();
    editProformaLines.forEach((line: any, index: number) => {
      const prod = productByArticleCode.get((line.articleCode || "").toLowerCase());
      if (prod) {
        newSelections.set(prod.productId, {
          productId: prod.productId,
          articleCode: prod.articleCode,
          productName: prod.productName,
          availableBales: prod.baleCount,
          totalWeight: prod.totalWeight,
          selectedQty: line.quantity,
          pricePerBale: line.pricePerBale,
        });
      } else {
        const syntheticId = -(index + 1);
        newSelections.set(syntheticId, {
          productId: syntheticId,
          articleCode: line.articleCode,
          productName: line.productName || line.articleCode,
          availableBales: 0,
          totalWeight: 0,
          selectedQty: line.quantity,
          pricePerBale: line.pricePerBale,
        });
      }
    });
    if (newSelections.size > 0) setSelections(newSelections);
    setEditModeInitialized(true);
  }, [editingProformaId, editProformaLines, selectedLocation, inventoryData, inventoryLoading, editModeInitialized]);

  const categoryGroups: CategoryGroup[] = activeInventoryData.reduce((groups, item) => {
    const catId = item.categoryId || 0;
    let group = groups.find((g) => (g.categoryId || 0) === catId);
    if (!group) {
      group = {
        categoryId: item.categoryId,
        categoryName: item.category || "Uncategorized",
        baleCount: 0,
        totalWeight: 0,
        totalCost: 0,
        totalSellValue: 0,
        productCount: 0,
        products: [],
      };
      groups.push(group);
    }
    group.baleCount += item.baleCount;
    group.totalWeight += item.totalWeight;
    group.totalCost += item.totalCost;
    group.totalSellValue += item.baleCount * parseFloat(item.sellingPrice || "0");
    group.productCount += 1;
    group.products.push(item);
    return groups;
  }, [] as CategoryGroup[]);

  const sortedLocations = [...locations].sort((a, b) => a.name.localeCompare(b.name));
  const filteredLocations = sortedLocations.filter((l) =>
    l.name.toLowerCase().includes(locationSearch.toLowerCase())
  );

  const filteredProducts = useMemo(() => {
    const q = productSearch.toLowerCase();
    return applySortProducts(
      activeInventoryData.filter((p) => {
        const matchesSearch = !q || p.productName.toLowerCase().includes(q) || p.articleCode.toLowerCase().includes(q);
        const matchesCat = categoryFilter === "__all__" || p.category === categoryFilter;
        const hideZero = proformaMode ? hideZeroAvailable : !showZeroStock;
        if (hideZero && p.baleCount === 0) return false;
        if (proformaMode && showSelectedOnly) return matchesSearch && matchesCat && selections.has(p.productId);
        return matchesSearch && matchesCat;
      }),
      prodSortField,
      prodSortDir
    );
  }, [activeInventoryData, productSearch, categoryFilter, prodSortField, prodSortDir, proformaMode, hideZeroAvailable, showZeroStock, showSelectedOnly, selections]);

  const regularProducts = filteredProducts.filter((p) => !isSpecialFactoryCategory(p.category || ""));
  const specialProducts = filteredProducts.filter((p) => isSpecialFactoryCategory(p.category || ""));

  const handleLocationClick = (location: Location) => {
    setSelectedLocation(location);
    setProductSearch("");
    setCategoryFilter("__all__");
  };

  const handleBackToLocations = () => {
    setSelectedLocation(null);
    setLocationSearch("");
    setProductSearch("");
    setCategoryFilter("__all__");
    setProformaMode(false);
    setSelections(new Map());
  };

  useEscapeBack(selectedLocation ? handleBackToLocations : null);

  const toggleProformaMode = useCallback(() => {
    if (proformaMode) {
      setProformaMode(false);
      setSelections(new Map());
      setShowSelectedOnly(false);
    } else {
      setProformaMode(true);
    }
  }, [proformaMode]);

  const selectAllVisible = useCallback(() => {
    setSelections((prev) => {
      const next = new Map(prev);
      filteredProducts.forEach((prod) => {
        if (!next.has(prod.productId)) {
          next.set(prod.productId, {
            productId: prod.productId,
            articleCode: prod.articleCode,
            productName: prod.productName,
            availableBales: prod.baleCount,
            totalWeight: prod.totalWeight,
            selectedQty: prod.baleCount,
            pricePerBale: prod.sellingPrice || "0",
          });
        }
      });
      return next;
    });
  }, [filteredProducts]);

  const deselectAllVisible = useCallback(() => {
    setSelections((prev) => {
      const next = new Map(prev);
      filteredProducts.forEach((prod) => next.delete(prod.productId));
      return next;
    });
    setShowSelectedOnly(false);
  }, [filteredProducts]);

  const toggleSelection = useCallback((prod: FactoryBaleProduct) => {
    setSelections((prev) => {
      const next = new Map(prev);
      if (next.has(prod.productId)) {
        next.delete(prod.productId);
      } else {
        next.set(prod.productId, {
          productId: prod.productId,
          articleCode: prod.articleCode,
          productName: prod.productName,
          availableBales: prod.baleCount,
          totalWeight: prod.totalWeight,
          selectedQty: prod.baleCount,
          pricePerBale: prod.sellingPrice || "0",
        });
      }
      return next;
    });
  }, []);

  const updateSelectionQty = useCallback((productId: number, qty: string) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const existing = next.get(productId);
      if (existing) {
        const parsed = parseInt(qty);
        next.set(productId, { ...existing, selectedQty: isNaN(parsed) ? 0 : Math.max(0, parsed) });
      }
      return next;
    });
  }, []);

  const updateSelectionPrice = useCallback((productId: number, price: string) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const existing = next.get(productId);
      if (existing) {
        next.set(productId, { ...existing, pricePerBale: price });
      }
      return next;
    });
  }, []);

  const applySellingPrices = useCallback(() => {
    setSelections((prev) => {
      const next = new Map(prev);
      for (const [productId, sel] of next) {
        const prod = activeInventoryData.find((p) => p.productId === productId);
        if (prod) next.set(productId, { ...sel, pricePerBale: prod.sellingPrice || "0" });
      }
      return next;
    });
  }, [activeInventoryData]);

  const applyProductionPrices = useCallback(() => {
    setSelections((prev) => {
      const next = new Map(prev);
      for (const [productId, sel] of next) {
        const prod = activeInventoryData.find((p) => p.productId === productId);
        if (prod) next.set(productId, { ...sel, pricePerBale: String(prod.productionPrice || "0") });
      }
      return next;
    });
  }, [activeInventoryData]);

  const updateFinalizePrice = useCallback((productId: number, price: string) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const existing = next.get(productId);
      if (existing) next.set(productId, { ...existing, pricePerBale: price });
      return next;
    });
  }, []);

  const updateFinalizeQty = useCallback((productId: number, qty: string) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const existing = next.get(productId);
      if (existing) {
        const parsed = parseInt(qty);
        next.set(productId, { ...existing, selectedQty: isNaN(parsed) ? 0 : Math.max(0, parsed) });
      }
      return next;
    });
  }, []);

  const removeFromFinalize = useCallback((productId: number) => {
    setSelections((prev) => {
      const next = new Map(prev);
      next.delete(productId);
      return next;
    });
  }, []);

  const selectedItems = Array.from(selections.values()).filter((s) => s.selectedQty > 0);
  const grandTotal = selectedItems.reduce((sum, item) => sum + item.selectedQty * parseFloat(item.pricePerBale || "0"), 0);
  const totalSelectedBales = selectedItems.reduce((sum, item) => sum + item.selectedQty, 0);
  const totalSelectedKg = selectedItems.reduce((sum, item) => {
    const weightPerBale = item.availableBales > 0 ? item.totalWeight / item.availableBales : 0;
    return sum + item.selectedQty * weightPerBale;
  }, 0);

  const getOverloadedItems = () =>
    selectedItems
      .filter((i) => i.selectedQty > i.availableBales)
      .map((i) => ({ articleCode: i.articleCode, productName: i.productName, requested: i.selectedQty, available: i.availableBales }));

  const handleFinalize = () => {
    if (selectedItems.length === 0) {
      toast({ title: "No items selected", description: "Select at least one item with quantity > 0", variant: "destructive" });
      return;
    }
    const overloaded = getOverloadedItems();
    if (overloaded.length > 0) {
      setOverloadWarning({ open: true, items: overloaded, pendingFn: () => { setSavedProformaId(null); setFinalizeOpen(true); } });
      return;
    }
    setSavedProformaId(null);
    setFinalizeOpen(true);
  };

  const doSaveProforma = () => {
    const lines = selectedItems.map((item) => ({
      articleCode: item.articleCode,
      productName: item.productName,
      quantity: item.selectedQty,
      pricePerBale: item.pricePerBale,
    }));
    if (editingProformaId) {
      replaceLinesMutation.mutate({ id: editingProformaId, lines });
    } else {
      bulkCreateMutation.mutate({
        customerId: parseInt(selectedCustomerId),
        name: proformaName.trim(),
        isActive: false,
        lines,
      });
    }
  };

  const handleSaveProforma = () => {
    if (!selectedCustomerId) {
      toast({ title: "Select a customer", variant: "destructive" });
      return;
    }
    if (!proformaName.trim()) {
      toast({ title: "Enter a proforma name", variant: "destructive" });
      return;
    }
    const overloaded = getOverloadedItems();
    if (overloaded.length > 0) {
      setOverloadWarning({ open: true, items: overloaded, pendingFn: doSaveProforma });
      return;
    }
    doSaveProforma();
  };

  const toggleProformaAutoSave = () => {
    const next = !proformaAutoSave;
    setProformaAutoSave(next);
    try { localStorage.setItem("proforma-inventory-autosave", String(next)); } catch {}
    if (!next && autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!proformaAutoSave || !proformaMode || !editingProformaId || selections.size === 0 || !editModeInitialized) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      isSilentAutoSaveRef.current = true;
      doSaveProforma();
      autoSaveTimerRef.current = null;
    }, 2000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proformaAutoSave, proformaMode, editingProformaId, selections, editModeInitialized]);

  const handleExportExcel = () => {
    if (!savedProformaId) return;
    window.open(`/api/factory/customer-proformas/${savedProformaId}/export/excel`, "_blank");
  };

  const handleExportPdf = () => {
    if (!savedProformaId) return;
    if (!navigator.onLine) { window.print(); return; }
    window.open(`/api/factory/customer-proformas/${savedProformaId}/export/pdf`, "_blank");
  };

  const handleCloseFinalizeDialog = () => {
    setFinalizeOpen(false);
    if (savedProformaId) {
      setProformaMode(false);
      setSelections(new Map());
      setSavedProformaId(null);
      setProformaName("");
      setSelectedCustomerId("");
    }
  };

  const filteredCustomers = customers.filter((c) =>
    c.legalName.toLowerCase().includes(customerSearch.toLowerCase())
  );

  const fmt = (n: number | null | undefined) => {
    if (n == null || isNaN(n)) return "0";
    return n.toLocaleString(undefined, { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
  };

  const renderFinalizeDialog = () => (
    <Dialog open={finalizeOpen} onOpenChange={(open) => { if (!open) handleCloseFinalizeDialog(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-finalize-title">
            {savedProformaId ? "Proforma Saved" : "Finalize Proforma"}
          </DialogTitle>
        </DialogHeader>

        {!savedProformaId ? (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Proforma Name</label>
              <Input
                placeholder="e.g. March 2026 Order"
                value={proformaName}
                onChange={(e) => setProformaName(e.target.value)}
                data-testid="input-proforma-name"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Customer</label>
              {showCreateCustomer ? (
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Customer name..."
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    className="flex-1"
                    data-testid="input-new-customer-name"
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      if (newCustomerName.trim()) createCustomerMutation.mutate({ legalName: newCustomerName.trim() });
                    }}
                    disabled={!newCustomerName.trim() || createCustomerMutation.isPending}
                    data-testid="button-save-new-customer"
                  >
                    <Check className="h-4 w-4 mr-1" /> Save
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setShowCreateCustomer(false); setNewCustomerName(""); }}
                    data-testid="button-cancel-new-customer"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search customers..."
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        className="pl-9"
                        data-testid="input-search-customers"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowCreateCustomer(true)}
                      data-testid="button-create-customer"
                    >
                      <Plus className="h-4 w-4 mr-1" /> New
                    </Button>
                  </div>
                  <div className="max-h-32 overflow-y-auto border rounded-md">
                    {filteredCustomers.length === 0 ? (
                      <div className="text-center text-muted-foreground text-sm py-3">No customers found</div>
                    ) : (
                      filteredCustomers.map((c) => (
                        <div
                          key={c.id}
                          className={`px-3 py-2 cursor-pointer text-sm hover-elevate ${selectedCustomerId === String(c.id) ? "bg-primary/10 font-medium" : ""}`}
                          onClick={() => setSelectedCustomerId(String(c.id))}
                          data-testid={`row-customer-${c.id}`}
                        >
                          {c.legalName}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">
                Items ({selectedItems.length} selected, {totalSelectedBales} bales)
              </label>
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Article</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right w-[100px]">Qty</TableHead>
                      <TableHead className="text-right w-[120px]">Price/Bale</TableHead>
                      <TableHead className="text-right w-[120px]">Total</TableHead>
                      <TableHead className="w-[40px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedItems.map((item) => {
                      const lineTotal = item.selectedQty * parseFloat(item.pricePerBale || "0");
                      return (
                        <TableRow key={item.productId} data-testid={`row-finalize-item-${item.productId}`}>
                          <TableCell className="font-mono text-xs">{item.articleCode}</TableCell>
                          <TableCell className="text-sm">{item.productName}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              value={item.selectedQty}
                              onChange={(e) => updateFinalizeQty(item.productId, e.target.value)}
                              className="w-[80px] text-right ml-auto"
                              min={1}
                              data-testid={`input-finalize-qty-${item.productId}`}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              value={item.pricePerBale}
                              onChange={(e) => updateFinalizePrice(item.productId, e.target.value)}
                              className="w-[100px] text-right ml-auto"
                              step="0.01"
                              data-testid={`input-finalize-price-${item.productId}`}
                            />
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatAmount(lineTotal)}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeFromFinalize(item.productId)}
                              data-testid={`button-remove-finalize-${item.productId}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-muted/50 font-bold">
                      <TableCell colSpan={2}>Grand Total</TableCell>
                      <TableCell className="text-right font-mono">{totalSelectedBales}</TableCell>
                      <TableCell></TableCell>
                      <TableCell className="text-right font-mono">{formatAmount(grandTotal)}</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleCloseFinalizeDialog} data-testid="button-cancel-finalize">
                Cancel
              </Button>
              <Button
                onClick={handleSaveProforma}
                disabled={!selectedCustomerId || !proformaName.trim() || selectedItems.length === 0 || bulkCreateMutation.isPending || replaceLinesMutation.isPending}
                data-testid="button-save-proforma"
              >
                <FileText className="h-4 w-4 mr-1" />
                {(bulkCreateMutation.isPending || replaceLinesMutation.isPending) ? "Saving..." : editingProformaId ? "Update Proforma" : "Save Proforma"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-center py-4">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 mb-3">
                <Check className="h-6 w-6 text-green-600 dark:text-green-300" />
              </div>
              <p className="text-sm text-muted-foreground">
                Proforma "{proformaName}" saved with {selectedItems.length} items, {totalSelectedBales} bales.
              </p>
            </div>
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" onClick={handleExportExcel} data-testid="button-export-excel">
                <FileSpreadsheet className="h-4 w-4 mr-1" /> Export Excel
              </Button>
              <Button variant="outline" onClick={handleExportPdf} data-testid="button-export-pdf">
                <Download className="h-4 w-4 mr-1" /> Export PDF
              </Button>
            </div>
            <div className="flex justify-center pt-2">
              <Button onClick={handleCloseFinalizeDialog} data-testid="button-done-proforma">
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );

  // ─── View 1: Location list ────────────────────────────────────────────────
  if (!selectedLocation) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6 flex-wrap">
          <div>
            <PageHeader title="Location Inventory" subtitle="Physical bales on ground by location" />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const p = new URLSearchParams();
              if (hideAvgCost) p.set("includeCost", "0");
              if (hideSellingPrice) p.set("includeSellPrice", "0");
              const qs = p.toString();
              window.open(`/api/factory/location-inventory/export/all${qs ? "?" + qs : ""}`, "_blank");
            }}
            data-testid="button-export-all-locations"
          >
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Export All (Excel)
          </Button>
        </div>

        <Card className="p-4 w-full">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Search locations..."
              value={locationSearch}
              onChange={(e) => setLocationSearch(e.target.value)}
              className="pl-10"
              data-testid="input-search-locations"
            />
          </div>

          {locationsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : locations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No locations found.</div>
          ) : (
            <div className="rounded-md border overflow-hidden w-full">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0 z-30">
                  <tr className="h-12">
                    <th className="text-left px-3 font-medium">Name</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLocations.length === 0 ? (
                    <tr>
                      <td className="text-center py-8 text-muted-foreground">No locations found matching your search</td>
                    </tr>
                  ) : (
                    filteredLocations.map((location) => (
                      <tr
                        key={location.id}
                        className="border-t hover-elevate cursor-pointer h-12"
                        onClick={() => handleLocationClick(location)}
                        data-testid={`row-location-${location.id}`}
                      >
                        <td className="px-3 font-medium">
                          <div className="flex items-center gap-2 justify-between">
                            <div className="flex items-center gap-2">
                              <MapPin className="h-4 w-4 text-muted-foreground" />
                              {location.name}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => openRenameDialog(location, e)}
                              data-testid={`button-rename-location-${location.id}`}
                              title="Rename location"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
          {!locationsLoading && filteredLocations.length > 0 && (
            <div className="mt-4 text-sm text-muted-foreground">
              Showing {filteredLocations.length} of {locations.length} locations
            </div>
          )}
        </Card>

        <Dialog open={renameDialogOpen} onOpenChange={(open) => { if (!open) setRenameDialogOpen(false); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename Location</DialogTitle>
              <DialogDescription>
                Enter a new name for <strong>{renamingLocation?.name}</strong>.
              </DialogDescription>
            </DialogHeader>
            <div className="py-2">
              <Input
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
                placeholder="Location name"
                data-testid="input-rename-location"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && renameInput.trim() && renamingLocation) {
                    renameLocationMutation.mutate({ id: renamingLocation.id, name: renameInput.trim() });
                  }
                }}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRenameDialogOpen(false)} data-testid="button-rename-cancel">
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (renameInput.trim() && renamingLocation) {
                    renameLocationMutation.mutate({ id: renamingLocation.id, name: renameInput.trim() });
                  }
                }}
                disabled={!renameInput.trim() || renameLocationMutation.isPending}
                data-testid="button-rename-confirm"
              >
                {renameLocationMutation.isPending ? "Saving..." : "Rename"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ─── View 2: Product table ────────────────────────────────────────────────
  const allCategoryNames = [...categoryGroups]
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName))
    .map((g) => g.categoryName);

  const statsBales = activeInventoryData.reduce((s, p) => s + p.baleCount - (p.loadingCount ?? 0), 0);
  const statsKg = activeInventoryData.reduce((s, p) => s + p.totalWeight, 0);
  const statsCostValue = activeInventoryData.reduce((s, p) => s + p.baleCount * p.productionPrice, 0);
  const statsSellValue = activeInventoryData.reduce((s, p) => s + p.baleCount * parseFloat(p.sellingPrice || "0"), 0);

  const totalBales = regularProducts.reduce((s, p) => s + p.baleCount, 0);
  const totalKg = regularProducts.reduce((s, p) => s + p.totalWeight, 0);
  const totalSellValue = regularProducts.reduce((s, p) => s + p.baleCount * parseFloat(p.sellingPrice || "0"), 0);
  const totalProdValue = regularProducts.reduce((s, p) => s + p.baleCount * p.productionPrice, 0);
  const spTotalBales = specialProducts.reduce((s, p) => s + p.baleCount, 0);
  const spTotalKg = specialProducts.reduce((s, p) => s + p.totalWeight, 0);
  const spTotalSellValue = specialProducts.reduce((s, p) => s + p.baleCount * parseFloat(p.sellingPrice || "0"), 0);
  const spTotalProdValue = specialProducts.reduce((s, p) => s + p.baleCount * p.productionPrice, 0);

  const colSpan = 2 + (proformaMode ? 2 : 0) + (hideSellingPrice ? 0 : 4) + (proformaMode ? 0 : 1);

  const renderProductRow = (prod: FactoryBaleProduct, testIdSuffix = "") => {
    const weightPerBale = prod.baleCount > 0 ? prod.totalWeight / prod.baleCount : 0;
    const isSelected = selections.has(prod.productId);
    const selection = selections.get(prod.productId);
    return (
      <tr
        key={prod.productId}
        className={`border-t h-12 ${proformaMode && isSelected ? "bg-primary/5" : ""}`}
        data-testid={`row-product${testIdSuffix}-${prod.productId}`}
      >
        {proformaMode && (
          <td className="px-2 text-center">
            <Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(prod)} data-testid={`checkbox-product${testIdSuffix}-${prod.productId}`} />
          </td>
        )}
        <td className="px-3 text-muted-foreground text-xs">{prod.category || "Uncategorized"}</td>
        <td className="px-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => !proformaMode && navigate(`/factory/bale-product-history/${prod.productId}/${selectedLocation.id}`)}
              className={`text-left font-medium ${proformaMode ? "" : "hover:underline cursor-pointer"}`}
              data-testid={`link-product${testIdSuffix}-${prod.productId}`}
            >
              {prod.productName}
            </button>
            {prod.isInactive && <Badge variant="outline" className="text-xs text-muted-foreground no-default-active-elevate">Inactive</Badge>}
          </div>
          {prod.articleCode && <div className="text-xs text-muted-foreground font-mono mt-0.5">{prod.articleCode}</div>}
        </td>
        <td className="text-right px-3 font-mono whitespace-nowrap">
          <span>{prod.baleCount - (prod.loadingCount ?? 0)}</span>
        </td>
        {proformaMode && (
          <td className="text-right px-3">
            {isSelected && selection ? (
              <Input type="number" value={selection.selectedQty} onChange={(e) => updateSelectionQty(prod.productId, e.target.value)} className="w-[70px] text-right ml-auto" min={1} data-testid={`input-qty${testIdSuffix}-${prod.productId}`} />
            ) : <span className="text-muted-foreground">-</span>}
          </td>
        )}
        {proformaMode && (
          <td className="text-right px-3">
            {isSelected && selection ? (
              <Input type="number" value={selection.pricePerBale} onChange={(e) => updateSelectionPrice(prod.productId, e.target.value)} className="w-[90px] text-right ml-auto" step="0.01" data-testid={`input-price${testIdSuffix}-${prod.productId}`} />
            ) : <span className="text-muted-foreground">-</span>}
          </td>
        )}
        <td className="text-right px-3 font-mono">{fmt(weightPerBale)}</td>
        {!hideSellingPrice && <td className="text-right px-3 font-mono">{formatAmount(parseFloat(prod.sellingPrice || "0"))}</td>}
        {!hideSellingPrice && <td className="text-right px-3 font-mono">{formatAmount(prod.baleCount * parseFloat(prod.sellingPrice || "0"))}</td>}
        {!hideSellingPrice && <td className="text-right px-3 font-mono">{formatAmount(prod.productionPrice)}</td>}
        {!hideSellingPrice && <td className="text-right px-3 font-mono">{formatAmount(prod.baleCount * prod.productionPrice)}</td>}
        <td className="text-right px-3 font-mono">{fmt(prod.totalWeight)}</td>
        {!proformaMode && (
          <td className="px-1 text-center">
            <div className="flex items-center justify-center gap-0.5">
              <Button size="icon" variant="ghost" className="h-7 w-7" title="View details" onClick={() => navigate(`/factory/bale-product-history/${prod.productId}/${selectedLocation.id}`)} data-testid={`button-view-details${testIdSuffix}-${prod.productId}`}>
                <Package className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" title="Print barcodes" onClick={() => handleReprintProduct(prod)} data-testid={`button-print-barcodes${testIdSuffix}-${prod.productId}`}>
                <Tag className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Remove bales" onClick={() => { setDeleteProduct(prod); setDeleteQty(1); setDeleteDialogOpen(true); }} data-testid={`button-delete-product${testIdSuffix}-${prod.productId}`}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </td>
        )}
      </tr>
    );
  };

  const renderMobileCard = (prod: FactoryBaleProduct, testIdSuffix = "") => {
    const weightPerBale = prod.baleCount > 0 ? prod.totalWeight / prod.baleCount : 0;
    const isSelected = selections.has(prod.productId);
    const selection = selections.get(prod.productId);
    return (
      <Card key={prod.productId} className={`p-3 ${proformaMode && isSelected ? "ring-2 ring-primary" : ""}`} data-testid={`card-product${testIdSuffix}-${prod.productId}`}>
        <div className="flex items-center gap-2 mb-2">
          {proformaMode && (
            <Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(prod)} data-testid={`checkbox-mobile${testIdSuffix}-${prod.productId}`} />
          )}
          <Package className="h-4 w-4 text-muted-foreground" />
          <button
            onClick={() => !proformaMode && navigate(`/factory/bale-product-history/${prod.productId}/${selectedLocation.id}`)}
            className={`text-left font-medium flex-1 ${proformaMode ? "" : "text-primary hover:underline cursor-pointer"}`}
            data-testid={`link-mobile${testIdSuffix}-${prod.productId}`}
          >
            {prod.productName}
          </button>
          {prod.isInactive && <Badge variant="outline" className="text-xs text-muted-foreground no-default-active-elevate shrink-0">Inactive</Badge>}
          {!proformaMode && (
            <div className="flex items-center gap-0.5 ml-auto">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleReprintProduct(prod)} data-testid={`button-reprint-mobile${testIdSuffix}-${prod.productId}`}>
                <Tag className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => { setDeleteProduct(prod); setDeleteQty(1); setDeleteDialogOpen(true); }} data-testid={`button-delete-mobile${testIdSuffix}-${prod.productId}`}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <span>{prod.articleCode}</span>
          {prod.category && <span>| {prod.category}</span>}
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-muted-foreground">Bales: </span>
            <span className="font-mono">{prod.baleCount - (prod.loadingCount ?? 0)}</span>
          </div>
          <div className="text-right"><span className="text-muted-foreground">Wt/Bale: </span><span className="font-mono">{fmt(weightPerBale)} KG</span></div>
          <div><span className="text-muted-foreground">Total KG: </span><span className="font-mono">{fmt(prod.totalWeight)}</span></div>
          {!hideSellingPrice && <div className="text-right"><span className="text-muted-foreground">Sell Value: </span><span className="font-mono font-medium">{formatAmount(prod.baleCount * parseFloat(prod.sellingPrice || "0"))}</span></div>}
        </div>
        {proformaMode && isSelected && selection && (
          <div className="mt-2 pt-2 border-t flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Qty:</span>
            <Input type="number" value={selection.selectedQty} onChange={(e) => updateSelectionQty(prod.productId, e.target.value)} className="w-20 text-right" min={1} data-testid={`input-qty-mobile${testIdSuffix}-${prod.productId}`} />
            <span className="text-xs text-muted-foreground">/ {prod.baleCount}</span>
            <span className="text-xs text-muted-foreground ml-2">Price:</span>
            <Input type="number" value={selection.pricePerBale} onChange={(e) => updateSelectionPrice(prod.productId, e.target.value)} className="w-24 text-right" step="0.01" data-testid={`input-price-mobile${testIdSuffix}-${prod.productId}`} />
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className={`p-4 md:p-6 max-w-6xl mx-auto ${proformaMode && selections.size > 0 ? "pb-24" : ""}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={handleBackToLocations}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            data-testid="breadcrumb-locations"
          >
            Locations
          </button>
          <span className="text-muted-foreground text-sm">/</span>
          <h1 className="text-xl md:text-2xl font-bold" data-testid="text-page-title">{selectedLocation.name}</h1>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => openRenameDialog(selectedLocation, e)}
            data-testid="button-rename-selected-location"
            title="Rename location"
          >
            <Pencil className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={proformaMode ? "destructive" : "outline"}
            size="sm"
            onClick={toggleProformaMode}
            data-testid="button-toggle-proforma-mode"
          >
            <ClipboardList className="h-4 w-4 mr-1" />
            {proformaMode ? "Exit Proforma" : "Proforma Mode"}
          </Button>
          <Button variant="outline" size="icon" onClick={() => handlePrint()} data-testid="button-print" title="Print">
            <Printer className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              const p = new URLSearchParams();
              if (hideAvgCost) p.set("includeCost", "0");
              if (hideSellingPrice) p.set("includeSellPrice", "0");
              const qs = p.toString();
              window.open(`/api/factory/location-inventory/${selectedLocation.id}/export/excel${qs ? "?" + qs : ""}`, "_blank");
            }}
            data-testid="button-export-location-excel"
            title="Export Excel"
          >
            <FileSpreadsheet className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground mb-4" data-testid="text-subtitle">
        Physical bales on ground · IN_STOCK
      </p>

      {/* Stat chips */}
      {!inventoryLoading && (
        <div className="flex flex-wrap gap-2 mb-4">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted text-sm">
            <Package className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Bales:</span>
            <span className="font-mono font-semibold" data-testid="stat-total-bales">{statsBales.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted text-sm">
            <span className="text-muted-foreground">Total KG:</span>
            <span className="font-mono font-semibold" data-testid="stat-total-kg">{fmt(statsKg)}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted text-sm">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Categories:</span>
            <span className="font-mono font-semibold" data-testid="stat-categories">{categoryGroups.length}</span>
          </div>
          {!hideAvgCost && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted text-sm">
              <span className="text-muted-foreground">Cost Value:</span>
              <span className="font-mono font-semibold" data-testid="stat-cost-value">{formatAmount(statsCostValue)}</span>
            </div>
          )}
          {!hideSellingPrice && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted text-sm">
              <span className="text-muted-foreground">Sell Value:</span>
              <span className="font-mono font-semibold" data-testid="stat-sell-value">{formatAmount(statsSellValue)}</span>
            </div>
          )}
        </div>
      )}

      {/* Proforma advisory — only visible inside proforma mode */}
      {proformaMode && (
        <div className="mb-3 flex items-start gap-2 px-3 py-2.5 rounded-md bg-amber-500/10 border border-amber-500/25 text-sm text-amber-800 dark:text-amber-300" data-testid="note-proforma-advisory">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <span>
            Available quantities shown do not subtract V5 reserved allocations. Check the{" "}
            <span className="font-medium">Stock Allocation V5</span> page for net availability before committing.
          </span>
        </div>
      )}

      {/* Proforma controls */}
      {proformaMode && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          {editingProformaId && (
            <div className="w-full flex items-center gap-2 mb-1 p-2 rounded-md bg-primary/10 border border-primary/20">
              <FileText className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-medium text-primary">Editing proforma: <span className="font-bold">{proformaName}</span></span>
              <span className="text-xs text-muted-foreground ml-1 flex-1">
                {proformaAutoSave ? "— Changes auto-save 2 s after you stop editing" : "— Select items and click Update Proforma to save changes"}
              </span>
              <button
                onClick={toggleProformaAutoSave}
                className={`flex items-center gap-1.5 px-2.5 h-7 rounded border text-xs font-medium transition-colors shrink-0 ${
                  proformaAutoSave
                    ? "bg-green-500/10 border-green-500/50 text-green-600 dark:text-green-400"
                    : "bg-background border-border text-muted-foreground"
                }`}
                data-testid="button-proforma-autosave-toggle"
              >
                <Zap className={`h-3.5 w-3.5 ${proformaAutoSave ? "fill-green-500 text-green-500" : ""}`} />
                Autosave
                <span className={`w-7 h-3.5 rounded-full relative transition-colors ${proformaAutoSave ? "bg-green-500" : "bg-muted-foreground/30"}`}>
                  <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform ${proformaAutoSave ? "translate-x-3.5" : "translate-x-0.5"}`} />
                </span>
              </button>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={selectAllVisible} data-testid="button-select-all">
            <Check className="h-4 w-4 mr-1" /> Select All
          </Button>
          <Button variant="outline" size="sm" onClick={deselectAllVisible} data-testid="button-deselect-all">
            <X className="h-4 w-4 mr-1" /> Deselect All
          </Button>
          {selections.size > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={applySellingPrices} data-testid="button-apply-selling-price">Apply Sell Price</Button>
              <Button variant="outline" size="sm" onClick={applyProductionPrices} data-testid="button-apply-production-price">Apply Prod Price</Button>
            </>
          )}
          <div className="flex items-center gap-1.5 ml-2">
            <Checkbox checked={showSelectedOnly} onCheckedChange={(v) => setShowSelectedOnly(!!v)} id="show-selected-only" data-testid="checkbox-show-selected-only" />
            <label htmlFor="show-selected-only" className="text-sm cursor-pointer select-none">Selected only</label>
          </div>
          <Button
            variant={hideZeroAvailable ? "outline" : "secondary"}
            size="sm"
            onClick={() => setHideZeroAvailable((v) => !v)}
            data-testid="button-toggle-zero-available"
          >
            {hideZeroAvailable ? "Show 0" : "Hide 0"}
          </Button>
          {selections.size > 0 && (
            <Badge variant="secondary" className="text-sm ml-auto">
              {selections.size} items, {Array.from(selections.values()).reduce((s, v) => s + v.selectedQty, 0)} bales
            </Badge>
          )}
        </div>
      )}

      {/* Main card — toolbar + table */}
      <Card className="p-4 w-full" ref={printRef}>
        {/* Toolbar */}
        <div className="flex flex-col gap-2 mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search product or article code..."
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-products"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={categoryFilter} onValueChange={setCategoryFilter} data-testid="select-category-filter">
              <SelectTrigger className="w-[160px]" data-testid="select-category-filter-trigger">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Categories</SelectItem>
                {allCategoryNames.map((name) => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={prodSortField} onValueChange={(v) => setProdSortField(v as SortField)} data-testid="select-sort-field">
              <SelectTrigger className="w-[120px]" data-testid="select-sort-trigger">
                <ArrowUpDown className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="bales">Bales</SelectItem>
                <SelectItem value="kg">KG</SelectItem>
                <SelectItem value="value">Value</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => setProdSortDir((d) => d === "asc" ? "desc" : "asc")} data-testid="button-sort-dir">
              {prodSortDir === "asc" ? "↑" : "↓"}
            </Button>
            {!proformaMode && (
              <Button
                variant={showZeroStock ? "default" : "outline"}
                size="sm"
                onClick={() => setShowZeroStock(v => !v)}
                data-testid="button-show-zero-stock"
                className="gap-1.5"
              >
                <Eye className="h-4 w-4" />
                {showZeroStock ? "Hide zero" : "Show zero"}
              </Button>
            )}
          </div>
        </div>

        {/* Loading skeleton */}
        {(inventoryLoading || (proformaMode && availableLoading)) && (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}

        {/* Mobile cards */}
        {!inventoryLoading && !(proformaMode && availableLoading) && (
          <div className="md:hidden space-y-3">
            {regularProducts.length === 0 && specialProducts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground" data-testid="text-no-products">
                No products found{productSearch || categoryFilter !== "__all__" ? " matching your filters" : " at this location"}
              </div>
            ) : (
              <>
                {regularProducts.map((prod) => renderMobileCard(prod))}
                {regularProducts.length > 0 && (
                  <Card className="p-3 bg-muted/50" data-testid="text-product-totals">
                    <div className="flex items-center justify-between gap-2 font-bold text-sm">
                      <span>Total ({regularProducts.length} products, {totalBales.toLocaleString()} bales)</span>
                      <span className="font-mono">{fmt(totalKg)} KG</span>
                    </div>
                    {!hideSellingPrice && (
                      <div className="flex justify-between text-sm font-mono font-bold">
                        <span>{formatAmount(totalSellValue)} sell</span>
                        <span>{formatAmount(totalProdValue)} prod</span>
                      </div>
                    )}
                  </Card>
                )}
                {specialProducts.length > 0 && (
                  <>
                    <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide pt-2">Wipers &amp; Garbage</p>
                    {specialProducts.map((prod) => renderMobileCard(prod, "-sp"))}
                    <Card className="p-3 bg-muted/50" data-testid="text-special-product-totals">
                      <div className="flex items-center justify-between gap-2 font-bold text-sm">
                        <span>Total ({specialProducts.length} products, {spTotalBales.toLocaleString()} bales)</span>
                        <span className="font-mono">{fmt(spTotalKg)} KG</span>
                      </div>
                      {!hideSellingPrice && <div className="text-right text-sm font-mono font-bold">{formatAmount(spTotalSellValue)} sell</div>}
                    </Card>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* Desktop table */}
        {!inventoryLoading && !(proformaMode && availableLoading) && (
          <div className="hidden md:block space-y-0 w-full">
            <div className="rounded-md border table-responsive w-full">
              <table className="table-fixed text-sm" style={{ minWidth: "820px", width: "100%" }}>
                <colgroup>
                  {proformaMode && <col style={{ width: "36px" }} />}
                  <col style={{ width: "110px" }} />
                  <col style={{ minWidth: "200px" }} />
                  <col style={{ width: "70px" }} />
                  {proformaMode && <col style={{ width: "80px" }} />}
                  {proformaMode && <col style={{ width: "110px" }} />}
                  <col style={{ width: "110px" }} />
                  {!hideSellingPrice && <col style={{ width: "110px" }} />}
                  {!hideSellingPrice && <col style={{ width: "130px" }} />}
                  {!hideSellingPrice && <col style={{ width: "110px" }} />}
                  {!hideSellingPrice && <col style={{ width: "130px" }} />}
                  <col style={{ width: "100px" }} />
                  {!proformaMode && <col style={{ width: "100px" }} />}
                </colgroup>
                <thead className="bg-muted/50 sticky top-0 z-30">
                  <tr className="h-12">
                    {proformaMode && <th className="px-2"></th>}
                    <th className="text-left px-3 font-medium">Category</th>
                    <th className="text-left px-3 font-medium whitespace-nowrap">Product</th>
                    <th className="text-right px-3 font-medium whitespace-nowrap">{proformaMode ? "Available" : "Bales"}</th>
                    {proformaMode && <th className="text-right px-3 font-medium">Qty</th>}
                    {proformaMode && <th className="text-right px-3 font-medium">Price/Bale</th>}
                    <th className="text-right px-3 font-medium">Avg KG/Bale</th>
                    {!hideSellingPrice && <th className="text-right px-3 font-medium">Sell Price</th>}
                    {!hideSellingPrice && <th className="text-right px-3 font-medium">Sell Value</th>}
                    {!hideSellingPrice && <th className="text-right px-3 font-medium">Cost Price</th>}
                    {!hideSellingPrice && <th className="text-right px-3 font-medium">Cost Value</th>}
                    <th className="text-right px-3 font-medium">Total KG</th>
                    {!proformaMode && <th className="text-center px-3 font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {regularProducts.length === 0 && specialProducts.length === 0 ? (
                    <tr>
                      <td colSpan={colSpan} className="text-center py-8 text-muted-foreground" data-testid="text-no-products-desktop">
                        No products found{productSearch || categoryFilter !== "__all__" ? " matching your filters" : " at this location"}
                      </td>
                    </tr>
                  ) : (
                    <>
                      {regularProducts.map((prod) => renderProductRow(prod))}
                      {regularProducts.length > 0 && (
                        <tr className="border-t bg-muted/50 h-12 font-bold">
                          {proformaMode && <td></td>}
                          <td className="px-3" colSpan={2}>Total ({regularProducts.length} products)</td>
                          <td className="text-right px-3 font-mono">{totalBales.toLocaleString()}</td>
                          {proformaMode && <td></td>}
                          {proformaMode && <td></td>}
                          <td className="text-right px-3 font-mono">{proformaMode ? fmt(totalKg) : ""}</td>
                          {!hideSellingPrice && <td></td>}
                          {!hideSellingPrice && <td className="text-right px-3 font-mono">{formatAmount(totalSellValue)}</td>}
                          {!hideSellingPrice && <td></td>}
                          {!hideSellingPrice && <td className="text-right px-3 font-mono">{formatAmount(totalProdValue)}</td>}
                          <td className="text-right px-3 font-mono">{fmt(totalKg)}</td>
                          {!proformaMode && <td></td>}
                        </tr>
                      )}
                    </>
                  )}
                </tbody>
              </table>
            </div>

            {specialProducts.length > 0 && (
              <div className="mt-6">
                <p className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Wipers &amp; Garbage</p>
                <div className="rounded-md border table-responsive w-full">
                  <table className="table-fixed text-sm" style={{ minWidth: "820px", width: "100%" }}>
                    <colgroup>
                      {proformaMode && <col style={{ width: "36px" }} />}
                      <col style={{ width: "110px" }} />
                      <col style={{ minWidth: "200px" }} />
                      <col style={{ width: "70px" }} />
                      {proformaMode && <col style={{ width: "80px" }} />}
                      {proformaMode && <col style={{ width: "110px" }} />}
                      <col style={{ width: "110px" }} />
                      {!hideSellingPrice && <col style={{ width: "110px" }} />}
                      {!hideSellingPrice && <col style={{ width: "130px" }} />}
                      {!hideSellingPrice && <col style={{ width: "110px" }} />}
                      {!hideSellingPrice && <col style={{ width: "130px" }} />}
                      <col style={{ width: "100px" }} />
                      {!proformaMode && <col style={{ width: "100px" }} />}
                    </colgroup>
                    <thead className="bg-muted/50 sticky top-0 z-30">
                      <tr className="h-12">
                        {proformaMode && <th className="px-2"></th>}
                        <th className="text-left px-3 font-medium">Category</th>
                        <th className="text-left px-3 font-medium whitespace-nowrap">Product</th>
                        <th className="text-right px-3 font-medium whitespace-nowrap">{proformaMode ? "Available" : "Bales"}</th>
                        {proformaMode && <th className="text-right px-3 font-medium">Qty</th>}
                        {proformaMode && <th className="text-right px-3 font-medium">Price/Bale</th>}
                        <th className="text-right px-3 font-medium">Avg KG/Bale</th>
                        {!hideSellingPrice && <th className="text-right px-3 font-medium">Sell Price</th>}
                        {!hideSellingPrice && <th className="text-right px-3 font-medium">Sell Value</th>}
                        {!hideSellingPrice && <th className="text-right px-3 font-medium">Cost Price</th>}
                        {!hideSellingPrice && <th className="text-right px-3 font-medium">Cost Value</th>}
                        <th className="text-right px-3 font-medium">Total KG</th>
                        {!proformaMode && <th className="text-center px-3 font-medium">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {specialProducts.map((prod) => renderProductRow(prod, "-sp"))}
                      <tr className="border-t bg-muted/50 h-12 font-bold">
                        {proformaMode && <td></td>}
                        <td className="px-3" colSpan={2}>Total ({specialProducts.length} products)</td>
                        <td className="text-right px-3 font-mono">{spTotalBales.toLocaleString()}</td>
                        {proformaMode && <td></td>}
                        {proformaMode && <td></td>}
                        <td className="text-right px-3 font-mono">{proformaMode ? fmt(spTotalKg) : ""}</td>
                        {!hideSellingPrice && <td></td>}
                        {!hideSellingPrice && <td className="text-right px-3 font-mono">{formatAmount(spTotalSellValue)}</td>}
                        {!hideSellingPrice && <td></td>}
                        {!hideSellingPrice && <td className="text-right px-3 font-mono">{formatAmount(spTotalProdValue)}</td>}
                        <td className="text-right px-3 font-mono">{fmt(spTotalKg)}</td>
                        {!proformaMode && <td></td>}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {!inventoryLoading && filteredProducts.length > 0 && (
          <div className="mt-4 text-sm text-muted-foreground">
            Showing {filteredProducts.length} of {activeInventoryData.length} products
          </div>
        )}
      </Card>

      {/* Proforma sticky footer */}
      {proformaMode && selections.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 py-3 shadow-lg">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="secondary" className="text-sm">{selections.size} items</Badge>
              <span className="text-sm font-mono font-medium">{totalSelectedBales} bales</span>
              <span className="text-sm font-mono text-muted-foreground">{fmt(totalSelectedKg)} KG</span>
              <span className="text-sm font-mono text-muted-foreground">{formatAmount(grandTotal)} total</span>
            </div>
            <div className="flex items-center gap-2">
              {editingProformaId && proformaAutoSave && (
                <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                  <Zap className="h-3.5 w-3.5 fill-green-500" />
                  {replaceLinesMutation.isPending ? "Saving…" : "Auto-saving"}
                </span>
              )}
              <Button
                onClick={editingProformaId ? handleSaveProforma : handleFinalize}
                disabled={(bulkCreateMutation.isPending || replaceLinesMutation.isPending) && !!editingProformaId}
                data-testid="button-finalize-proforma-bar"
              >
                <FileText className="h-4 w-4 mr-1" />
                {editingProformaId ? "Update Proforma" : "Finalize Proforma"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {renderFinalizeDialog()}

      <Dialog open={overloadWarning.open} onOpenChange={(open) => { if (!open) setOverloadWarning({ open: false, items: [], pendingFn: null }); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle data-testid="text-overload-warning-title">Stock Overload Warning</DialogTitle>
            <DialogDescription>
              The following items exceed available stock. You can still proceed, but the proforma will contain more bales than currently in stock.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-auto max-h-[300px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Requested</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overloadWarning.items.map((item) => (
                  <TableRow key={item.articleCode} data-testid={`row-overload-${item.articleCode}`}>
                    <TableCell className="font-mono text-xs">{item.articleCode}</TableCell>
                    <TableCell className="text-sm">{item.productName}</TableCell>
                    <TableCell className="text-right font-mono font-semibold text-destructive">{item.requested}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{item.available}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOverloadWarning({ open: false, items: [], pendingFn: null })} data-testid="button-overload-cancel">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const fn = overloadWarning.pendingFn;
                setOverloadWarning({ open: false, items: [], pendingFn: null });
                fn?.();
              }}
              data-testid="button-overload-proceed"
            >
              Proceed Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={(open) => { if (!open) { setDeleteDialogOpen(false); setDeleteProduct(null); setDeleteSupervisorUser(""); setDeleteSupervisorPass(""); setDeleteReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Bales from Stock</DialogTitle>
            <DialogDescription>
              {deleteProduct && (
                <>Remove bales of <strong>{deleteProduct.productName}</strong> from <strong>{selectedLocation.name}</strong>. Current stock: <strong>{deleteProduct.baleCount}</strong> bale(s).</>
              )}
            </DialogDescription>
          </DialogHeader>
          {!navigator.onLine && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
              You are offline. This removal will be queued and processed when back online.
            </div>
          )}
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="delete-qty">Quantity to Remove</Label>
              <Input
                id="delete-qty"
                type="number"
                min={1}
                max={deleteProduct?.baleCount ?? 1}
                value={deleteQty}
                onChange={(e) => setDeleteQty(Math.max(1, Math.min(deleteProduct?.baleCount ?? 1, parseInt(e.target.value) || 1)))}
                data-testid="input-delete-qty"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="delete-reason">Reason</Label>
              <Input id="delete-reason" placeholder="e.g. damaged, lost, correction" value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} data-testid="input-delete-reason" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="delete-supervisor-user">Supervisor Username</Label>
              <Input id="delete-supervisor-user" placeholder="Admin/Owner/Manager username" value={deleteSupervisorUser} onChange={(e) => setDeleteSupervisorUser(e.target.value)} data-testid="input-delete-supervisor-user" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="delete-supervisor-pass">Supervisor Password</Label>
              <Input id="delete-supervisor-pass" type="password" placeholder="Password" value={deleteSupervisorPass} onChange={(e) => setDeleteSupervisorPass(e.target.value)} data-testid="input-delete-supervisor-pass" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteDialogOpen(false); setDeleteProduct(null); setDeleteSupervisorUser(""); setDeleteSupervisorPass(""); setDeleteReason(""); }} data-testid="button-delete-cancel">
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={removeBalesMutation.isPending || !deleteSupervisorUser || !deleteSupervisorPass || deleteQty < 1}
              onClick={() => {
                if (!deleteProduct || !selectedLocation) return;
                removeBalesMutation.mutate({
                  productId: deleteProduct.productId,
                  locationId: selectedLocation.id,
                  qty: deleteQty,
                  supervisorUsername: deleteSupervisorUser,
                  supervisorPassword: deleteSupervisorPass,
                  reason: deleteReason,
                });
              }}
              data-testid="button-delete-confirm"
            >
              {removeBalesMutation.isPending ? "Removing..." : `Remove ${deleteQty} Bale(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reprintDialogOpen} onOpenChange={(open) => { if (!open) { setReprintDialogOpen(false); setReprintBales([]); setReprintProduct(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle data-testid="text-reprint-dialog-title">
              Print Barcodes{reprintProduct ? ` — ${reprintProduct.productName}` : ""}
            </DialogTitle>
            <DialogDescription>
              {reprintLoading
                ? "Loading bales…"
                : `${reprintBales.length} bale(s) in stock at ${selectedLocation.name}. Click Print to generate labels for all of them.`}
            </DialogDescription>
          </DialogHeader>
          {reprintLoading ? (
            <div className="space-y-2 py-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : reprintBales.length > 0 ? (
            <div className="overflow-auto max-h-[260px] rounded-md border">
              <table className="text-sm w-full">
                <thead className="bg-muted/50">
                  <tr className="h-9">
                    <th className="text-left px-3 font-medium">Reference No.</th>
                    <th className="text-right px-3 font-medium">KG</th>
                    <th className="text-right px-3 font-medium">Pcs</th>
                  </tr>
                </thead>
                <tbody>
                  {reprintBales.map((row: any) => (
                    <tr key={row.bale.id} className="border-t h-9" data-testid={`row-reprint-bale-${row.bale.id}`}>
                      <td className="px-3 font-mono text-xs text-muted-foreground">{row.bale.referenceNumber || row.bale.baleCode}</td>
                      <td className="px-3 text-right font-mono text-xs">{parseFloat(row.bale.weightKg).toFixed(1)}</td>
                      <td className="px-3 text-right font-mono text-xs">{row.bale.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-2">No IN_STOCK bales found for this product at this location.</p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setReprintDialogOpen(false); setReprintBales([]); setReprintProduct(null); }} data-testid="button-reprint-cancel">
              Cancel
            </Button>
            <Button onClick={handleDoPrint} disabled={reprintLoading || reprintBales.length === 0} data-testid="button-reprint-confirm">
              <Printer className="h-4 w-4 mr-1.5" />
              Print {reprintBales.length > 0 ? `${reprintBales.length} Label(s)` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reprintDesignPickerOpen} onOpenChange={setReprintDesignPickerOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Choose A4 Label Design</DialogTitle>
            <DialogDescription>Pick a color design for the A4 label sheet.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 py-2">
            {A4_DESIGN_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                variant="outline"
                onClick={() => {
                  setReprintDesignPickerOpen(false);
                  openBrowserReprintLabels(reprintPendingLabels, opt.value as A4DesignColor);
                }}
                data-testid={`button-inv-design-${opt.value}`}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReprintDesignPickerOpen(false)} data-testid="button-inv-design-cancel">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameDialogOpen} onOpenChange={(open) => { if (!open) setRenameDialogOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Location</DialogTitle>
            <DialogDescription>
              Enter a new name for <strong>{renamingLocation?.name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              value={renameInput}
              onChange={(e) => setRenameInput(e.target.value)}
              placeholder="Location name"
              data-testid="input-rename-location"
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameInput.trim() && renamingLocation) {
                  renameLocationMutation.mutate({ id: renamingLocation.id, name: renameInput.trim() });
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)} data-testid="button-rename-cancel">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (renameInput.trim() && renamingLocation) {
                  renameLocationMutation.mutate({ id: renamingLocation.id, name: renameInput.trim() });
                }
              }}
              disabled={!renameInput.trim() || renameLocationMutation.isPending}
              data-testid="button-rename-confirm"
            >
              {renameLocationMutation.isPending ? "Saving..." : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
