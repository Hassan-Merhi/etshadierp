import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Search, Plus, Package, Edit, FileSpreadsheet, Trash2, Download,
  PlusCircle, MinusCircle, ChevronDown, Settings, ChevronLeft, ChevronRight,
  Tag, Layers, Pencil, Check, X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { StockItemDetailsDialog } from "@/components/StockItemDetailsDialog";
import { StockItemEditDialog } from "@/components/StockItemEditDialog";
import { StockItemCreateDialog } from "@/components/StockItemCreateDialog";
import { CombinedImportDialog } from "@/components/CombinedImportDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { utils, writeFile } from "@/lib/excelHelper";

interface Location {
  id: number;
  code: string;
  name: string;
}

interface StockItem {
  id: number;
  code: string;
  name: string;
  barcode: string | null;
  uom: string;
  stockGroupId: number | null;
  gradeId: number | null;
  categoryId: number | null;
  sellingPrice: string;
  active: boolean;
  companyId: number;
}

interface StockGroup {
  id: number;
  code: string;
  name: string;
}

interface StockGrade {
  id: number;
  name: string;
  active: boolean;
}

interface StockCategory {
  id: number;
  name: string;
  active: boolean;
}

interface PagedStockItemsResponse {
  data: StockItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const PAGE_SIZE = 100;

export default function StockItems() {
  const { data: myErpPages } = useQuery<{ hiddenErpCostFields?: string[] }>({ queryKey: ["/api/my-erp-pages"] });
  const hideStockRates = (myErpPages?.hiddenErpCostFields ?? []).includes("stock_rates");

  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<number | null>(null);
  const [selectedGradeFilter, setSelectedGradeFilter] = useState<number | null>(null);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<number | "none" | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const [selectedStockItemId, setSelectedStockItemId] = useState<number | null>(null);
  const [selectedStockItemName, setSelectedStockItemName] = useState<string>("");
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editStockItemId, setEditStockItemId] = useState<number | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [assignCategoryDialogOpen, setAssignCategoryDialogOpen] = useState(false);
  const [pendingCategoryId, setPendingCategoryId] = useState<string>("");

  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [adjustStockItemId, setAdjustStockItemId] = useState<string>("");
  const [adjustLocationId, setAdjustLocationId] = useState<string>("");
  const [adjustQuantity, setAdjustQuantity] = useState<string>("");
  const [adjustType, setAdjustType] = useState<"add" | "subtract">("add");

  // Grades management
  const [manageGradesOpen, setManageGradesOpen] = useState(false);
  const [newGradeName, setNewGradeName] = useState("");
  const [editingGradeId, setEditingGradeId] = useState<number | null>(null);
  const [editingGradeName, setEditingGradeName] = useState("");

  // Categories management
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");

  const { toast } = useToast();
  const { formatAmount } = useCurrencyContext();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => { setCurrentPage(1); }, [selectedGroupFilter, selectedGradeFilter, selectedCategoryFilter]);

  const pagedQueryKey = [
    "/api/stock-items",
    { page: currentPage, pageSize: PAGE_SIZE, search: debouncedSearch, stockGroupId: selectedGroupFilter, gradeId: selectedGradeFilter, categoryId: selectedCategoryFilter },
  ];
  const { data: pagedData, isLoading } = useQuery<PagedStockItemsResponse>({
    queryKey: pagedQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(currentPage), pageSize: String(PAGE_SIZE) });
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (selectedGroupFilter !== null) params.set("stockGroupId", String(selectedGroupFilter));
      if (selectedGradeFilter !== null) params.set("gradeId", String(selectedGradeFilter));
      if (selectedCategoryFilter !== null) params.set("categoryId", String(selectedCategoryFilter));
      const res = await fetch(`/api/stock-items?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch stock items");
      return res.json();
    },
  });

  const displayItems: StockItem[] = pagedData?.data ?? [];
  const totalItems = pagedData?.total ?? 0;
  const totalPages = pagedData?.totalPages ?? 1;

  const { data: allStockItems = [], refetch: refetchAllItems } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items"],
    enabled: false,
    staleTime: 5 * 60 * 1000,
  });

  const { data: stockGroups = [] } = useQuery<StockGroup[]>({ queryKey: ["/api/stock-groups"] });
  const { data: stockGrades = [] } = useQuery<StockGrade[]>({ queryKey: ["/api/stock-grades"] });
  const { data: stockCategories = [] } = useQuery<StockCategory[]>({ queryKey: ["/api/stock-categories"] });
  const { data: locations = [] } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const { data: allAliasesRaw = [] } = useQuery<{ stockItemId: number; aliasCode: string }[]>({
    queryKey: ["/api/stock-items/all-code-aliases"],
    queryFn: async () => {
      const res = await fetch("/api/stock-items/all-code-aliases", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60 * 1000,
  });
  const aliasMap = new Map<number, string[]>();
  for (const a of allAliasesRaw) {
    if (!aliasMap.has(a.stockItemId)) aliasMap.set(a.stockItemId, []);
    aliasMap.get(a.stockItemId)!.push(a.aliasCode);
  }

  // Derived stats
  const activeCount = displayItems.filter(i => i.active).length;
  const inactiveCount = displayItems.filter(i => !i.active).length;

  // ─── Mutations: stock items ───────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async (ids: number[]) => apiRequest("POST", "/api/stock-items/bulk-delete", { ids }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      setSelectedIds([]);
      toast({ title: "Success", description: data.message || "Stock items deleted successfully" });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to delete stock items", variant: "destructive" });
    },
  });

  const adjustStockMutation = useMutation({
    mutationFn: async (data: { stockItemId: number; locationId: number; quantity: number; type: "add" | "subtract" }) =>
      apiRequest("POST", "/api/inventory/quick-adjust", data),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      setAdjustDialogOpen(false);
      setAdjustStockItemId(""); setAdjustLocationId(""); setAdjustQuantity(""); setAdjustType("add");
      toast({ title: "Success", description: data.message || "Stock adjusted successfully" });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to adjust stock", variant: "destructive" });
    },
  });

  const assignCategoryMutation = useMutation({
    mutationFn: async ({ ids, categoryId }: { ids: number[]; categoryId: number | null }) =>
      apiRequest("POST", "/api/stock-items/bulk-assign-category", { ids, categoryId }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      setSelectedIds([]); setAssignCategoryDialogOpen(false); setPendingCategoryId("");
      toast({ title: "Success", description: data.message || "Category assigned successfully" });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to assign category", variant: "destructive" });
    },
  });

  // ─── Mutations: grades ────────────────────────────────────────────────────
  const createGradeMutation = useMutation({
    mutationFn: async (name: string) => apiRequest("POST", "/api/stock-grades", { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-grades"] });
      setNewGradeName("");
      toast({ title: "Grade created" });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateGradeMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) =>
      apiRequest("PATCH", `/api/stock-grades/${id}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-grades"] });
      setEditingGradeId(null); setEditingGradeName("");
      toast({ title: "Grade updated" });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteGradeMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/stock-grades/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-grades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      toast({ title: "Grade deleted" });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // ─── Mutations: categories ────────────────────────────────────────────────
  const createCategoryMutation = useMutation({
    mutationFn: async (name: string) => apiRequest("POST", "/api/stock-categories", { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-categories"] });
      setNewCategoryName("");
      toast({ title: "Category created" });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) =>
      apiRequest("PATCH", `/api/stock-categories/${id}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-categories"] });
      setEditingCategoryId(null); setEditingCategoryName("");
      toast({ title: "Category updated" });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/stock-categories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-categories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      toast({ title: "Category deleted" });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // ─── Handlers ─────────────────────────────────────────────────────────────
  const handleAdjustStock = async () => {
    if (!adjustStockItemId || !adjustLocationId || !adjustQuantity) {
      toast({ title: "Error", description: "Please fill in all fields", variant: "destructive" }); return;
    }
    const qty = parseFloat(adjustQuantity);
    if (isNaN(qty) || qty <= 0) {
      toast({ title: "Error", description: "Please enter a valid quantity greater than 0", variant: "destructive" }); return;
    }
    adjustStockMutation.mutate({ stockItemId: parseInt(adjustStockItemId), locationId: parseInt(adjustLocationId), quantity: qty, type: adjustType });
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? displayItems.map(item => item.id) : []);
  };

  const handleSelectItem = (id: number, checked: boolean) => {
    setSelectedIds(prev => checked ? [...prev, id] : prev.filter(i => i !== id));
  };

  const allPageSelected = displayItems.length > 0 && displayItems.every(item => selectedIds.includes(item.id));

  const getStockGroupName = (stockGroupId: number | null) => {
    if (!stockGroupId) return null;
    return stockGroups.find(g => g.id === stockGroupId)?.name ?? null;
  };
  const getGradeName = (gradeId: number | null) => {
    if (!gradeId) return null;
    return stockGrades.find(g => g.id === gradeId)?.name ?? null;
  };
  const getCategoryName = (categoryId: number | null) => {
    if (!categoryId) return null;
    return stockCategories.find(c => c.id === categoryId)?.name ?? null;
  };

  const handleStockItemClick = (id: number, name: string) => {
    setSelectedStockItemId(id); setSelectedStockItemName(name); setDetailsDialogOpen(true);
  };
  const handleEditClick = (id: number, e: React.MouseEvent) => {
    e.stopPropagation(); setEditStockItemId(id); setEditDialogOpen(true);
  };

  const exportSalesHistory = async () => {
    if (!navigator.onLine) { toast({ title: "Not available offline", description: "Exports require a connection", variant: "destructive" }); return; }
    try {
      const res = await fetch("/api/stock-items/last-sales-export", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch sales history");
      const rows: {
        stockItemId: number; itemCode: string; itemName: string; voucherNumber: string;
        voucherDate: string; locationName: string; quantity: string; rate: string; amount: string; rn: number;
      }[] = await res.json();
      if (rows.length === 0) { toast({ title: "No sales data", description: "No sales history found for any item." }); return; }
      const data: Record<string, string>[] = [];
      let lastItemId: number | null = null;
      for (const row of rows) {
        if (lastItemId !== null && row.stockItemId !== lastItemId) data.push({});
        lastItemId = row.stockItemId;
        data.push({
          "Item Code": row.itemCode, "Item Name": row.itemName, "Sale #": String(row.rn),
          "Voucher No.": row.voucherNumber || "", "Date": row.voucherDate ? new Date(row.voucherDate).toLocaleDateString() : "",
          "Location": row.locationName || "",
          "Qty": row.quantity ? parseFloat(row.quantity).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "",
          "Rate": row.rate ? parseFloat(row.rate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "",
          "Amount": row.amount ? parseFloat(row.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "",
        });
      }
      const worksheet = utils.json_to_sheet(data);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Sales History");
      await writeFile(workbook, "stock-items-sales-history.xlsx");
    } catch {
      toast({ title: "Export failed", description: "Could not export sales history", variant: "destructive" });
    }
  };

  const exportToExcel = async () => {
    try {
      const [allRes, pricesRes, costDubaiRes, aliasesRes] = await Promise.all([
        fetch("/api/stock-items", { credentials: "include" }),
        fetch("/api/stock-item-location-prices/all", { credentials: "include" }),
        fetch("/api/stock-items/cost-dubai", { credentials: "include" }),
        fetch("/api/stock-items/all-code-aliases", { credentials: "include" }),
      ]);
      const allItems: StockItem[] = allRes.ok ? await allRes.json() : [];
      const locationPrices: { stockItemId: number; locationId: number; locationName: string; sellingPrice: string }[] = pricesRes.ok ? await pricesRes.json() : [];
      const costDubaiData: { stockItemId: number; costDubai: string }[] = costDubaiRes.ok ? await costDubaiRes.json() : [];
      const aliasData: { stockItemId: number; aliasCode: string }[] = aliasesRes.ok ? await aliasesRes.json() : [];

      const costDubaiMap = new Map<number, string>();
      for (const cd of costDubaiData) costDubaiMap.set(cd.stockItemId, cd.costDubai);

      const priceMap = new Map<number, Map<string, string>>();
      for (const lp of locationPrices) {
        if (!priceMap.has(lp.stockItemId)) priceMap.set(lp.stockItemId, new Map());
        priceMap.get(lp.stockItemId)!.set(lp.locationName, lp.sellingPrice);
      }

      const aliasMap = new Map<number, string[]>();
      for (const a of aliasData) {
        if (!aliasMap.has(a.stockItemId)) aliasMap.set(a.stockItemId, []);
        aliasMap.get(a.stockItemId)!.push(a.aliasCode);
      }

      const sortedLocations = locations.map(l => l.name).sort();
      const data = allItems.map(item => {
        const costDubai = costDubaiMap.get(item.id);
        const defaultPrice = item.sellingPrice || "0";
        const itemAliases = aliasMap.get(item.id) ?? [];
        const row: Record<string, string> = {
          Code: item.code, Name: item.name, Barcode: item.barcode || "",
          "Alias Codes": itemAliases.join(", "),
          UOM: item.uom,
          "Stock Group": getStockGroupName(item.stockGroupId) ?? "— No Group —",
          "Grade": getGradeName(item.gradeId) || "",
          "Category": getCategoryName(item.categoryId) || "",
          "Default Selling Price": formatAmount(defaultPrice),
          "Cost Dubai": costDubai ? formatAmount(costDubai) : "",
        };
        for (const loc of sortedLocations) {
          const locPrice = priceMap.get(item.id)?.get(loc);
          row[`Price - ${loc}`] = formatAmount(locPrice ?? defaultPrice);
        }
        row["Active"] = item.active ? "Yes" : "No";
        return row;
      });
      const worksheet = utils.json_to_sheet(data);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Stock Items");
      await writeFile(workbook, "stock-items.xlsx");
    } catch {
      toast({ title: "Export failed", description: "Could not export stock items", variant: "destructive" });
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      {/* ── Header ── */}
      <PageHeader title="Stock Items" subtitle="Manage all stock items in your company">
        <div className="flex flex-wrap items-center gap-2">
          {selectedIds.length > 0 && (
            <>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => { setPendingCategoryId(""); setAssignCategoryDialogOpen(true); }}
                data-testid="button-assign-category"
              >
                <Package className="h-4 w-4" />
                <span className="hidden sm:inline">Assign Category</span>
                <span className="sm:hidden">Category</span>
                <Badge variant="secondary" className="ml-1">{selectedIds.length}</Badge>
              </Button>
              <Button
                variant="destructive"
                className="gap-2"
                onClick={() => setDeleteDialogOpen(true)}
                data-testid="button-delete-selected"
              >
                <Trash2 className="h-4 w-4" />
                Delete {selectedIds.length}
              </Button>
            </>
          )}
          <Button
            className="gap-2"
            onClick={() => setCreateDialogOpen(true)}
            data-testid="button-add-item"
          >
            <Plus className="h-4 w-4" />
            Add Item
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2" data-testid="button-manage-dropdown">
                <Settings className="h-4 w-4" />
                Manage
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setImportDialogOpen(true)} data-testid="menu-import">
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Import
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { refetchAllItems(); setAdjustDialogOpen(true); }} data-testid="menu-adjust-stock">
                <Edit className="h-4 w-4 mr-2" />
                Adjust Stock
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportToExcel} data-testid="menu-export">
                <Download className="h-4 w-4 mr-2" />
                Export Stock Items
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportSalesHistory} data-testid="menu-export-sales-history">
                <Download className="h-4 w-4 mr-2" />
                Export Sales History
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { setNewGradeName(""); setEditingGradeId(null); setManageGradesOpen(true); }} data-testid="menu-manage-grades">
                <Tag className="h-4 w-4 mr-2" />
                Manage Grades
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setNewCategoryName(""); setEditingCategoryId(null); setManageCategoriesOpen(true); }} data-testid="menu-manage-categories">
                <Layers className="h-4 w-4 mr-2" />
                Manage Categories
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </PageHeader>

      {/* ── Stats pill bar ── */}
      <div className="flex flex-wrap gap-3">
        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Total</span>
          <span className="font-semibold">{totalItems.toLocaleString()}</span>
        </div>
        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          <span className="text-muted-foreground">Active</span>
          <span className="font-semibold">{activeCount.toLocaleString()}</span>
        </div>
        {inactiveCount > 0 && (
          <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-muted-foreground" />
            <span className="text-muted-foreground">Inactive</span>
            <span className="font-semibold">{inactiveCount.toLocaleString()}</span>
          </div>
        )}
        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm flex items-center gap-2">
          <Tag className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Grades</span>
          <span className="font-semibold">{stockGrades.length}</span>
        </div>
        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Categories</span>
          <span className="font-semibold">{stockCategories.length}</span>
        </div>
      </div>

      {/* ── Filters row ── */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
            data-testid="input-search"
          />
        </div>
        <Select
          value={selectedGroupFilter === null ? "all" : String(selectedGroupFilter)}
          onValueChange={(v) => setSelectedGroupFilter(v === "all" ? null : parseInt(v))}
        >
          <SelectTrigger className="w-40" data-testid="select-stock-group">
            <SelectValue placeholder="All Groups" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Groups</SelectItem>
            {stockGroups.map(g => (
              <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {stockGrades.length > 0 && (
          <Select
            value={selectedGradeFilter === null ? "all" : String(selectedGradeFilter)}
            onValueChange={(v) => setSelectedGradeFilter(v === "all" ? null : parseInt(v))}
          >
            <SelectTrigger className="w-36" data-testid="select-grade-filter">
              <SelectValue placeholder="All Grades" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Grades</SelectItem>
              {stockGrades.map(g => (
                <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {stockCategories.length > 0 && (
          <Select
            value={selectedCategoryFilter === null ? "all" : String(selectedCategoryFilter)}
            onValueChange={(v) => setSelectedCategoryFilter(v === "all" ? null : v === "none" ? "none" : parseInt(v))}
          >
            <SelectTrigger className="w-40" data-testid="select-category-filter">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="none">No Category</SelectItem>
              {stockCategories.map(c => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* ── Table ── */}
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block border rounded-xl overflow-auto max-h-[calc(100vh-300px)]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-30 bg-muted/40">
                <tr className="h-11 bg-muted/40 border-b">
                  <th className="w-10 px-3">
                    <Checkbox
                      checked={allPageSelected}
                      onCheckedChange={handleSelectAll}
                      data-testid="checkbox-select-all"
                    />
                  </th>
                  <th className="text-left px-3 font-medium">Name</th>
                  <th className="text-left px-3 font-medium">Group</th>
                  {stockGrades.length > 0 && <th className="text-left px-3 font-medium">Grade</th>}
                  {stockCategories.length > 0 && <th className="text-left px-3 font-medium">Category</th>}
                  <th className="text-left px-3 font-medium">Aliases</th>
                  <th className="text-left px-3 font-medium">Status</th>
                  <th className="w-20 px-3" />
                </tr>
              </thead>
              <tbody>
                {displayItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4 + (stockGrades.length > 0 ? 1 : 0) + (stockCategories.length > 0 ? 1 : 0)}
                      className="text-center py-12 text-muted-foreground"
                    >
                      {debouncedSearch ? "No items match your search" : "No stock items found"}
                    </td>
                  </tr>
                ) : (
                  displayItems.map((item) => (
                    <tr
                      key={item.id}
                      className="border-t hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => handleStockItemClick(item.id, item.name)}
                      data-testid={`row-stock-item-${item.id}`}
                    >
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.includes(item.id)}
                          onCheckedChange={(checked) => handleSelectItem(item.id, checked as boolean)}
                          data-testid={`checkbox-${item.id}`}
                        />
                      </td>
                      <td className="px-3 py-3" data-testid={`name-${item.id}`}>
                        <div className="font-medium leading-tight">{item.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{item.code} · {item.uom}</div>
                      </td>
                      <td className="px-3 py-3 text-sm text-muted-foreground" data-testid={`group-${item.id}`}>
                        {getStockGroupName(item.stockGroupId) ?? <span className="text-xs">—</span>}
                      </td>
                      {stockGrades.length > 0 && (
                        <td className="px-3 py-3" data-testid={`grade-${item.id}`}>
                          {getGradeName(item.gradeId)
                            ? <Badge variant="outline" className="text-xs font-normal">{getGradeName(item.gradeId)}</Badge>
                            : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                      )}
                      {stockCategories.length > 0 && (
                        <td className="px-3 py-3" data-testid={`category-${item.id}`}>
                          {getCategoryName(item.categoryId)
                            ? <Badge variant="secondary" className="text-xs">{getCategoryName(item.categoryId)}</Badge>
                            : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                      )}
                      <td className="px-3 py-3 max-w-[180px]" data-testid={`aliases-${item.id}`}>
                        {(aliasMap.get(item.id) ?? []).length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {(aliasMap.get(item.id) ?? []).map(code => (
                              <Badge key={code} variant="outline" className="text-xs font-mono font-normal">{code}</Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3" data-testid={`status-${item.id}`}>
                        <Badge variant={item.active ? "default" : "secondary"} className="text-xs">
                          {item.active ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => handleEditClick(item.id, e)}
                          data-testid={`button-edit-${item.id}`}
                          className="gap-1.5"
                        >
                          <Edit className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {totalItems > 0 && (
                <tfoot>
                  <tr className="border-t bg-muted/40">
                    <td colSpan={5 + (stockGrades.length > 0 ? 1 : 0) + (stockCategories.length > 0 ? 1 : 0)} className="px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                        <span>
                          Showing {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, totalItems)} of {totalItems.toLocaleString()} items
                        </span>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="outline" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1} data-testid="button-prev-page">
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <span className="px-2 text-sm">Page {currentPage} of {totalPages}</span>
                          <Button size="icon" variant="outline" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} data-testid="button-next-page">
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Mobile card view */}
          <div className="md:hidden space-y-2">
            <div className="flex items-center gap-2 pb-2 border-b">
              <Checkbox checked={allPageSelected} onCheckedChange={handleSelectAll} data-testid="checkbox-select-all-mobile" />
              <span className="text-sm text-muted-foreground">Select All</span>
            </div>
            {displayItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {debouncedSearch ? "No items match your search" : "No stock items found"}
              </div>
            ) : (
              displayItems.map((item) => (
                <div key={item.id} className="border rounded-xl p-3" data-testid={`card-stock-item-${item.id}`}>
                  <div className="flex items-start gap-3">
                    <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.includes(item.id)}
                        onCheckedChange={(checked) => handleSelectItem(item.id, checked as boolean)}
                        data-testid={`checkbox-mobile-${item.id}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleStockItemClick(item.id, item.name)}>
                      <div className="font-medium truncate" data-testid={`name-mobile-${item.id}`}>{item.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{item.code} · {item.uom}</div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        <Badge variant={item.active ? "default" : "secondary"} className="text-xs" data-testid={`status-mobile-${item.id}`}>
                          {item.active ? "Active" : "Inactive"}
                        </Badge>
                        {getGradeName(item.gradeId) && (
                          <Badge variant="outline" className="text-xs font-normal" data-testid={`grade-mobile-${item.id}`}>
                            {getGradeName(item.gradeId)}
                          </Badge>
                        )}
                        {getCategoryName(item.categoryId) && (
                          <Badge variant="secondary" className="text-xs" data-testid={`category-mobile-${item.id}`}>
                            {getCategoryName(item.categoryId)}
                          </Badge>
                        )}
                        {(aliasMap.get(item.id) ?? []).map(code => (
                          <Badge key={code} variant="outline" className="text-xs font-mono font-normal" data-testid={`alias-mobile-${item.id}`}>{code}</Badge>
                        ))}
                      </div>
                      {!hideStockRates && (
                        <div className="text-xs text-muted-foreground mt-1">{formatAmount(item.sellingPrice)}</div>
                      )}
                    </div>
                    <Button
                      size="sm" variant="ghost"
                      onClick={(e) => handleEditClick(item.id, e)}
                      data-testid={`button-edit-mobile-${item.id}`}
                      className="gap-1 shrink-0"
                    >
                      <Edit className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                  </div>
                </div>
              ))
            )}
            {totalItems > PAGE_SIZE && (
              <div className="flex items-center justify-between pt-2 text-sm text-muted-foreground">
                <span>{((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, totalItems)} of {totalItems}</span>
                <div className="flex gap-1">
                  <Button size="icon" variant="outline" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1} data-testid="button-prev-page-mobile">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="outline" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} data-testid="button-next-page-mobile">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Dialogs: stock items ── */}
      <StockItemDetailsDialog
        open={detailsDialogOpen && !!selectedStockItemId}
        onOpenChange={setDetailsDialogOpen}
        stockItemId={selectedStockItemId ?? 0}
        stockItemName={selectedStockItemName}
      />
      <StockItemEditDialog open={editDialogOpen} onOpenChange={setEditDialogOpen} stockItemId={editStockItemId} />
      <StockItemCreateDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
      <CombinedImportDialog open={importDialogOpen} onOpenChange={setImportDialogOpen} />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="dialog-confirm-delete">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedIds.length} stock {selectedIds.length === 1 ? "item" : "items"}? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { deleteMutation.mutate(selectedIds); setDeleteDialogOpen(false); }}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={assignCategoryDialogOpen} onOpenChange={setAssignCategoryDialogOpen}>
        <DialogContent data-testid="dialog-assign-category">
          <DialogHeader>
            <DialogTitle>Assign Category</DialogTitle>
            <DialogDescription>
              Choose a category to assign to the {selectedIds.length} selected {selectedIds.length === 1 ? "item" : "items"}.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label className="mb-2 block">Category</Label>
            <Select value={pendingCategoryId} onValueChange={setPendingCategoryId}>
              <SelectTrigger data-testid="select-assign-category">
                <SelectValue placeholder="Select a category..." />
              </SelectTrigger>
              <SelectContent>
                {stockCategories.map(cat => (
                  <SelectItem key={cat.id} value={cat.id.toString()}>{cat.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignCategoryDialogOpen(false)} data-testid="button-cancel-assign-category">Cancel</Button>
            <Button
              onClick={() => {
                const categoryId = pendingCategoryId === "" ? null : parseInt(pendingCategoryId);
                assignCategoryMutation.mutate({ ids: selectedIds, categoryId });
              }}
              disabled={pendingCategoryId === "" || assignCategoryMutation.isPending}
              data-testid="button-confirm-assign-category"
            >
              {assignCategoryMutation.isPending ? "Saving..." : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Adjust Stock ── */}
      <Dialog open={adjustDialogOpen} onOpenChange={setAdjustDialogOpen}>
        <DialogContent data-testid="dialog-adjust-stock">
          <DialogHeader>
            <DialogTitle>Adjust Stock Manually</DialogTitle>
            <DialogDescription>Add or subtract quantity from a stock item at a specific location</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Stock Item</Label>
              <Select value={adjustStockItemId} onValueChange={setAdjustStockItemId}>
                <SelectTrigger data-testid="select-adjust-stock-item">
                  <SelectValue placeholder="Select stock item..." />
                </SelectTrigger>
                <SelectContent>
                  {allStockItems.map(item => (
                    <SelectItem key={item.id} value={item.id.toString()}>{item.code} - {item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Select value={adjustLocationId} onValueChange={setAdjustLocationId}>
                <SelectTrigger data-testid="select-adjust-location">
                  <SelectValue placeholder="Select location..." />
                </SelectTrigger>
                <SelectContent>
                  {locations.map(loc => (
                    <SelectItem key={loc.id} value={loc.id.toString()}>{loc.code} - {loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Adjustment Type</Label>
              <div className="flex gap-2">
                <Button type="button" variant={adjustType === "add" ? "default" : "outline"} className="flex-1 gap-2" onClick={() => setAdjustType("add")} data-testid="button-adjust-add">
                  <PlusCircle className="h-4 w-4" /> Add (+)
                </Button>
                <Button type="button" variant={adjustType === "subtract" ? "destructive" : "outline"} className="flex-1 gap-2" onClick={() => setAdjustType("subtract")} data-testid="button-adjust-subtract">
                  <MinusCircle className="h-4 w-4" /> Subtract (-)
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input type="number" min="0" step="0.01" value={adjustQuantity} onChange={(e) => setAdjustQuantity(e.target.value)} placeholder="Enter quantity..." data-testid="input-adjust-quantity" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustDialogOpen(false)} data-testid="button-adjust-cancel">Cancel</Button>
            <Button onClick={handleAdjustStock} disabled={adjustStockMutation.isPending} data-testid="button-adjust-confirm">
              {adjustStockMutation.isPending ? "Adjusting..." : `${adjustType === "add" ? "Add" : "Subtract"} Stock`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Manage Grades ── */}
      <Dialog open={manageGradesOpen} onOpenChange={setManageGradesOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-manage-grades">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Tag className="h-4 w-4" /> Manage Grades</DialogTitle>
            <DialogDescription>Add, rename, or remove stock grades.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2 max-h-72 overflow-y-auto pr-1">
            {stockGrades.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No grades yet. Add one below.</p>
            )}
            {stockGrades.map(grade => (
              <div key={grade.id} className="flex items-center gap-2 group">
                {editingGradeId === grade.id ? (
                  <>
                    <Input
                      value={editingGradeName}
                      onChange={(e) => setEditingGradeName(e.target.value)}
                      className="flex-1 h-8 text-sm"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && editingGradeName.trim()) updateGradeMutation.mutate({ id: grade.id, name: editingGradeName.trim() });
                        if (e.key === "Escape") { setEditingGradeId(null); setEditingGradeName(""); }
                      }}
                      data-testid={`input-edit-grade-${grade.id}`}
                    />
                    <Button size="icon" variant="ghost" onClick={() => { if (editingGradeName.trim()) updateGradeMutation.mutate({ id: grade.id, name: editingGradeName.trim() }); }} disabled={updateGradeMutation.isPending} data-testid={`button-save-grade-${grade.id}`}>
                      <Check className="h-4 w-4 text-green-600" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => { setEditingGradeId(null); setEditingGradeName(""); }} data-testid={`button-cancel-grade-${grade.id}`}>
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-default">{grade.name}</span>
                    <Button size="icon" variant="ghost" onClick={() => { setEditingGradeId(grade.id); setEditingGradeName(grade.name); }} data-testid={`button-edit-grade-${grade.id}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => deleteGradeMutation.mutate(grade.id)} disabled={deleteGradeMutation.isPending} data-testid={`button-delete-grade-${grade.id}`}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-2 border-t">
            <Input
              placeholder="New grade name..."
              value={newGradeName}
              onChange={(e) => setNewGradeName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newGradeName.trim()) createGradeMutation.mutate(newGradeName.trim()); }}
              className="flex-1"
              data-testid="input-new-grade"
            />
            <Button
              onClick={() => { if (newGradeName.trim()) createGradeMutation.mutate(newGradeName.trim()); }}
              disabled={!newGradeName.trim() || createGradeMutation.isPending}
              className="gap-1.5"
              data-testid="button-add-grade"
            >
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Manage Categories ── */}
      <Dialog open={manageCategoriesOpen} onOpenChange={setManageCategoriesOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-manage-categories">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Layers className="h-4 w-4" /> Manage Categories</DialogTitle>
            <DialogDescription>Add, rename, or remove stock categories.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2 max-h-72 overflow-y-auto pr-1">
            {stockCategories.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No categories yet. Add one below.</p>
            )}
            {stockCategories.map(cat => (
              <div key={cat.id} className="flex items-center gap-2 group">
                {editingCategoryId === cat.id ? (
                  <>
                    <Input
                      value={editingCategoryName}
                      onChange={(e) => setEditingCategoryName(e.target.value)}
                      className="flex-1 h-8 text-sm"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && editingCategoryName.trim()) updateCategoryMutation.mutate({ id: cat.id, name: editingCategoryName.trim() });
                        if (e.key === "Escape") { setEditingCategoryId(null); setEditingCategoryName(""); }
                      }}
                      data-testid={`input-edit-category-${cat.id}`}
                    />
                    <Button size="icon" variant="ghost" onClick={() => { if (editingCategoryName.trim()) updateCategoryMutation.mutate({ id: cat.id, name: editingCategoryName.trim() }); }} disabled={updateCategoryMutation.isPending} data-testid={`button-save-category-${cat.id}`}>
                      <Check className="h-4 w-4 text-green-600" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => { setEditingCategoryId(null); setEditingCategoryName(""); }} data-testid={`button-cancel-category-${cat.id}`}>
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-default">{cat.name}</span>
                    <Button size="icon" variant="ghost" onClick={() => { setEditingCategoryId(cat.id); setEditingCategoryName(cat.name); }} data-testid={`button-edit-category-${cat.id}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => deleteCategoryMutation.mutate(cat.id)} disabled={deleteCategoryMutation.isPending} data-testid={`button-delete-category-${cat.id}`}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-2 border-t">
            <Input
              placeholder="New category name..."
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newCategoryName.trim()) createCategoryMutation.mutate(newCategoryName.trim()); }}
              className="flex-1"
              data-testid="input-new-category"
            />
            <Button
              onClick={() => { if (newCategoryName.trim()) createCategoryMutation.mutate(newCategoryName.trim()); }}
              disabled={!newCategoryName.trim() || createCategoryMutation.isPending}
              className="gap-1.5"
              data-testid="button-add-category"
            >
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
