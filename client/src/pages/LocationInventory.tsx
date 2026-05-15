import { useState, useEffect, useRef, useMemo } from "react";
import { useCursorNav } from "@/contexts/CursorNavContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "@/contexts/LocationContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useLocation as useRoute } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { ChevronRight, Package, MapPin, Layers, ShoppingCart, List, Printer, Upload, Download, Trash2, Search, AlertCircle, CheckCircle2, Archive, Calendar, X, ChevronDown, Globe, Eye, Pencil, FileSpreadsheet, MessageCircle, Check, Warehouse, TrendingUp, TrendingDown, ArrowUpDown, ArrowRight, Loader2 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { format } from "date-fns";
import { LocationCreateDialog } from "@/components/LocationCreateDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useReactToPrint } from "react-to-print";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { utils, writeFile, readFile, read, ExcelJS } from "@/lib/excelHelper";
import { useEscapeBack, hasAnyOpenDialog } from "@/hooks/use-escape-back";

interface Location {
  id: number;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  createdAt?: string;
}

interface InventoryItem {
  inventoryId: number;
  locationId: number;
  stockItemId: number;
  quantity: string;
  averageRate: string;
  totalValue: string;
  stockItemCode: string;
  stockItemName: string;
  stockItemUom: string;
  stockGroupId: number | null;
  stockGroupName: string | null;
  stockGroupCode: string | null;
  stockItemActive: boolean | null;
}

interface StockGroupSummary {
  groupId: number | null;
  groupCode: string | null;
  groupName: string;
  totalQuantity: number;
  totalValue: number;
  averageRate: number;
  itemCount: number;
  items: InventoryItem[];
}

interface ImportRow {
  Item_barcode: string;
  stockGroupCode?: string;
  quantity: string;
  rate: string;
  value: string;
}

export default function LocationInventory({ posUser }: { posUser?: any } = {}) {
  const [selectedLocationLocal, setSelectedLocationLocal] = useState<Location | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<StockGroupSummary | null>(null);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number>(0);
  const { registerCursorNav, clearCursorNav } = useCursorNav();
  const [viewAllItems, setViewAllItems] = useState<boolean>(false);
  const [printWithCost, setPrintWithCost] = useState<boolean>(false);
  const [locationSearchTerm, setLocationSearchTerm] = useState("");
  const [groupSearchTerm, setGroupSearchTerm] = useState("");
  const [itemSearchTerm, setItemSearchTerm] = useState("");
  const [asOfDate, setAsOfDate] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [showNegativeStock, setShowNegativeStock] = useState(false);
  const [showZeroStock, setShowZeroStock] = useState(false);
  const [negativeSearchTerm, setNegativeSearchTerm] = useState("");
  // All-locations combined stock view
  const [showAllStock, setShowAllStock] = useState(false);
  const [allStockGroupFilter, setAllStockGroupFilter] = useState<string>("");
  const [allStockSearchTerm, setAllStockSearchTerm] = useState("");
  const [allStockLocationFilter, setAllStockLocationFilter] = useState<string>("");
  const tableRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const { setSelectedLocation } = useLocation();
  const [_route, navigate] = useRoute();
  const { toast } = useToast();
  const { formatAmount } = useCurrencyContext();

  // Import dialog state
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportRow[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importComplete, setImportComplete] = useState(false);

  // Cost price import dialog state
  const [costPriceImportOpen, setCostPriceImportOpen] = useState(false);
  const [costPriceFile, setCostPriceFile] = useState<File | null>(null);
  const [costPricePreview, setCostPricePreview] = useState<Array<{ barcode: string; costPrice: number }>>([]);
  const [costPriceErrors, setCostPriceErrors] = useState<string[]>([]);
  const [isImportingCostPrice, setIsImportingCostPrice] = useState(false);
  const [costPriceImportComplete, setCostPriceImportComplete] = useState(false);

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Archive stock group dialog state
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  // Create location dialog state
  const [createLocationDialogOpen, setCreateLocationDialogOpen] = useState(false);

  // Rename location dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renamingLocation, setRenamingLocation] = useState<Location | null>(null);
  const [renameInput, setRenameInput] = useState("");

  // WhatsApp group dialog state
  const [waGroupDialogOpen, setWaGroupDialogOpen] = useState(false);
  const [waGroupLocation, setWaGroupLocation] = useState<Location | null>(null);
  const [waGroupSearch, setWaGroupSearch] = useState("");
  const [waGroupSelectedId, setWaGroupSelectedId] = useState<string>("");

  // Print handler
  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `${(selectedLocationLocal?.name || "Stock").replace(/\s+/g, "_")}_STK_${new Date().toLocaleDateString('en-CA')}`,
  });

  // Helper: set cost visibility then print
  const handlePrintWithOption = async (withCost: boolean) => {
    setPrintWithCost(withCost);
    setViewAllItems(true);
    setTimeout(() => handlePrint(), 150);
  };

  // Rename location mutation
  const renameLocationMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      const res = await apiRequest("PATCH", `/api/locations/${id}`, { name });
      return res.json();
    },
    onSuccess: (updated) => {
      toast({ title: "Location renamed", description: `Renamed to "${updated.name}".` });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      if (selectedLocationLocal?.id === updated.id) {
        setSelectedLocationLocal(updated);
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

  // WhatsApp group chats (fetched only when dialog is open)
  const { data: waChats = [], isLoading: waChatsLoading } = useQuery<{ id: string; name: string; type: string }[]>({
    queryKey: ["/api/whatsapp/chats/pos"],
    enabled: waGroupDialogOpen,
    staleTime: 60_000,
  });

  const waGroupMutation = useMutation({
    mutationFn: async ({ id, name, whatsappGroupChatId }: { id: number; name: string; whatsappGroupChatId: string | null }) => {
      const res = await apiRequest("PATCH", `/api/locations/${id}`, { name, whatsappGroupChatId });
      return res.json();
    },
    onSuccess: (updated) => {
      toast({
        title: updated.whatsappGroupChatId ? "WhatsApp group assigned" : "WhatsApp group removed",
        description: updated.whatsappGroupChatId
          ? `Group linked to ${updated.name}.`
          : `Group unlinked from ${updated.name}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      if (selectedLocationLocal?.id === updated.id) setSelectedLocationLocal(updated);
      setWaGroupDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const openWaGroupDialog = (loc: Location, e?: { stopPropagation: () => void }) => {
    e?.stopPropagation();
    setWaGroupLocation(loc);
    setWaGroupSelectedId((loc as any).whatsappGroupChatId ?? "");
    setWaGroupSearch("");
    setWaGroupDialogOpen(true);
  };

  // Fetch all locations (only for non-POS users)
  const { data: allLocations = [], isLoading: allLocationsLoading } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
    enabled: !posUser,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: true,
  });

  // For POS users, fetch their assigned locations (multi-location support)
  const { data: posAssignedLocations = [], isLoading: posLocationsLoading } = useQuery<Location[]>({
    queryKey: posUser ? ["/api/my-locations"] : [],
    enabled: !!posUser,
  });

  // Use the appropriate locations list based on user type
  const locations = posUser ? posAssignedLocations : allLocations;
  const locationsLoading = posUser ? posLocationsLoading : allLocationsLoading;

  // Fetch inventory for selected location (always current — never historical)
  const { data: inventoryData = [], isLoading: inventoryLoading, isFetching } = useQuery<InventoryItem[]>({
    queryKey: selectedLocationLocal 
      ? [`/api/locations/${selectedLocationLocal.id}/inventory`]
      : [],
    queryFn: async () => {
      const response = await fetch(`/api/locations/${selectedLocationLocal!.id}/inventory`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch inventory');
      return response.json();
    },
    enabled: !!selectedLocationLocal,
  });

  // Fetch opening inventory for selected location (only when fromDate is set)
  const { data: openingInventoryData = [], isLoading: openingInventoryLoading } = useQuery<InventoryItem[]>({
    queryKey: selectedLocationLocal && fromDate
      ? [`/api/locations/${selectedLocationLocal.id}/inventory`, { asOfDate: fromDate }]
      : [],
    queryFn: async () => {
      const url = `/api/locations/${selectedLocationLocal!.id}/inventory?asOfDate=${fromDate}`;
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch opening inventory');
      return response.json();
    },
    enabled: !!selectedLocationLocal && !!fromDate,
  });

  // Fetch closing inventory for selected location (only when asOfDate/To-date is set)
  // This is the historical snapshot at the END of the movement period.
  const { data: closingInventoryData = [], isLoading: closingInventoryLoading } = useQuery<InventoryItem[]>({
    queryKey: selectedLocationLocal && asOfDate
      ? [`/api/locations/${selectedLocationLocal.id}/inventory`, { asOfDate: asOfDate }]
      : [],
    queryFn: async () => {
      const url = `/api/locations/${selectedLocationLocal!.id}/inventory?asOfDate=${asOfDate}`;
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch closing inventory');
      return response.json();
    },
    enabled: !!selectedLocationLocal && !!asOfDate,
  });

  const { data: negativeStockData = [], isLoading: negativeStockLoading } = useQuery<any[]>({
    queryKey: ["/api/inventory/negative", { search: negativeSearchTerm }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (negativeSearchTerm) params.set("search", negativeSearchTerm);
      const response = await fetch(`/api/inventory/negative?${params}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch negative stock');
      return response.json();
    },
    enabled: showNegativeStock,
  });

  // All-locations combined inventory
  const { data: allInventoryData = [], isLoading: allInventoryLoading } = useQuery<any[]>({
    queryKey: ["/api/inventory"],
    queryFn: async () => {
      const response = await fetch("/api/inventory", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch inventory");
      return response.json();
    },
    enabled: showAllStock,
    staleTime: 30000,
  });

  // Derive unique locations from all inventory (sorted A-Z)
  const allInventoryLocations = useMemo(() => {
    const locs = new Map<number, { id: number; name: string }>();
    allInventoryData.forEach((item: any) => {
      if (item.locationId && !locs.has(item.locationId))
        locs.set(item.locationId, { id: item.locationId, name: item.locationName || "" });
    });
    return [...locs.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allInventoryData]);

  // Derive unique stock groups from all inventory (for filter dropdown)
  const allInventoryGroups = useMemo(() => {
    const groups = new Map<string, { id: number | null; name: string }>();
    allInventoryData.forEach((item: any) => {
      const key = String(item.stockGroupId ?? "null");
      if (!groups.has(key))
        groups.set(key, { id: item.stockGroupId ?? null, name: item.stockGroupName || "Unassigned" });
    });
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allInventoryData]);

  // Build combined rows: one per stock item, with qty-by-location map + avg cost + total value
  const combinedStockRows = useMemo(() => {
    const itemMap = new Map<number, {
      stockItemId: number;
      stockItemName: string;
      stockItemCode: string;
      stockGroupId: number | null;
      stockGroupName: string;
      qtyByLocation: Record<number, number>;
      totalQty: number;
      weightedCostSum: number; // sum(qty * avgRate) for weighted average
      totalValue: number;      // sum of totalValue across locations
    }>();
    allInventoryData.forEach((item: any) => {
      const qty = parseFloat(item.quantity || "0");
      if (qty === 0) return;
      if (!itemMap.has(item.stockItemId)) {
        itemMap.set(item.stockItemId, {
          stockItemId: item.stockItemId,
          stockItemName: item.stockItemName || "",
          stockItemCode: item.stockItemCode || "",
          stockGroupId: item.stockGroupId ?? null,
          stockGroupName: item.stockGroupName || "Unassigned",
          qtyByLocation: {},
          totalQty: 0,
          weightedCostSum: 0,
          totalValue: 0,
        });
      }
      const row = itemMap.get(item.stockItemId)!;
      row.qtyByLocation[item.locationId] = (row.qtyByLocation[item.locationId] || 0) + qty;
      row.totalQty += qty;
      const avgRate = parseFloat(item.averageRate || "0");
      const itemValue = parseFloat(item.totalValue || "0");
      row.weightedCostSum += qty * avgRate;
      row.totalValue += itemValue;
    });
    return [...itemMap.values()].map((row) => ({
      ...row,
      avgCost: row.totalQty > 0 ? row.weightedCostSum / row.totalQty : 0,
    }));
  }, [allInventoryData]);

  // Apply search + group filter, then sort by group → item name
  const filteredCombinedRows = useMemo(() => {
    return combinedStockRows
      .filter((row) => {
        if (allStockGroupFilter) {
          if (allStockGroupFilter === "null") {
            if (row.stockGroupId !== null) return false;
          } else {
            if (String(row.stockGroupId) !== allStockGroupFilter) return false;
          }
        }
        if (allStockLocationFilter) {
          const locId = parseInt(allStockLocationFilter, 10);
          const qty = row.qtyByLocation[locId];
          if (qty == null || qty === 0) return false;
        }
        if (allStockSearchTerm) {
          const s = allStockSearchTerm.toLowerCase();
          return (
            row.stockItemName.toLowerCase().includes(s) ||
            row.stockItemCode.toLowerCase().includes(s)
          );
        }
        return true;
      })
      .sort((a, b) => {
        const g = a.stockGroupName.localeCompare(b.stockGroupName);
        return g !== 0 ? g : a.stockItemName.localeCompare(b.stockItemName);
      });
  }, [combinedStockRows, allStockGroupFilter, allStockLocationFilter, allStockSearchTerm]);


  // Opening inventory map: stockItemId -> opening quantity (when fromDate is set)
  const openingInventoryMap = useMemo(() => {
    const map = new Map<number, number>();
    openingInventoryData.forEach((item: InventoryItem) => {
      map.set(item.stockItemId, parseFloat(item.quantity || "0"));
    });
    return map;
  }, [openingInventoryData]);

  // Opening quantity per stock group (summed from opening inventory map)
  const openingGroupQtyMap = useMemo(() => {
    const map = new Map<number, number>();
    openingInventoryData.forEach((item: InventoryItem) => {
      if (!item.stockGroupId) return;
      map.set(item.stockGroupId, (map.get(item.stockGroupId) || 0) + parseFloat(item.quantity || "0"));
    });
    return map;
  }, [openingInventoryData]);

  // Show movement mode: both dates must be set
  const showMovement = !!(fromDate && asOfDate);

  // In movement mode use the historical closing snapshot (asOfDate = "To" date);
  // otherwise use the live current inventory.
  const activeInventoryData = showMovement ? closingInventoryData : inventoryData;

  // Filter out items with 0 quantity (unless showZeroStock is on)
  const inventory = showZeroStock
    ? activeInventoryData
    : activeInventoryData.filter(item => parseFloat(item.quantity || "0") !== 0);

  // Separate unassigned items (no stock group) — show warning, not as a group
  const unassignedInventoryItems = inventory.filter(item => !item.stockGroupId);

  // Group inventory by stock group — skip items with no stock group
  const stockGroups: StockGroupSummary[] = inventory
    .filter(item => !!item.stockGroupId)
    .reduce((groups, item) => {
      const groupKey = item.stockGroupId!;
      let group = groups.find(g => g.groupId === groupKey);
      if (!group) {
        group = {
          groupId: item.stockGroupId,
          groupCode: item.stockGroupCode,
          groupName: item.stockGroupName || "Unknown Group",
          totalQuantity: 0,
          totalValue: 0,
          averageRate: 0,
          itemCount: 0,
          items: [],
        };
        groups.push(group);
      }
      const qty = parseFloat(item.quantity || "0");
      const value = parseFloat(item.totalValue || "0");
      group.totalQuantity += qty;
      group.totalValue += value;
      group.itemCount += 1;
      group.items.push(item);
      return groups;
    }, [] as StockGroupSummary[]);

  // Calculate average rate for each group
  stockGroups.forEach(group => {
    if (group.totalQuantity > 0) {
      group.averageRate = group.totalValue / group.totalQuantity;
    }
  });

  // Sort locations alphabetically (A-Z) by name
  const sortedLocations = [...locations].sort((a, b) => a.name.localeCompare(b.name));

  // Filter locations by search term
  const filteredLocations = sortedLocations.filter((location) =>
    (location.name ?? "").toLowerCase().includes(locationSearchTerm.toLowerCase())
  );

  // Sort stock groups alphabetically (A-Z) by name, nulls/Uncategorized last
  const sortedStockGroups = [...stockGroups].sort((a, b) => {
    if (a.groupId === null) return 1;
    if (b.groupId === null) return -1;
    return a.groupName.localeCompare(b.groupName);
  });

  // Filter stock groups by search term
  const filteredStockGroups = sortedStockGroups.filter((group) =>
    (group.groupName ?? "").toLowerCase().includes(groupSearchTerm.toLowerCase()) ||
    (group.groupCode ?? "").toLowerCase().includes(groupSearchTerm.toLowerCase())
  );

  // Filter and sort stock items alphabetically (A-Z) by name.
  // In movement mode: union of opening + closing items so that items sold out
  // during the period still appear (with Closing=0, Movement=negative).
  // In normal mode: derive from `inventory` (respects showZeroStock toggle).
  const filteredStockItems: InventoryItem[] = (() => {
    if (!selectedGroup) return [];

    if (showMovement) {
      // Build a map of closing items for the group
      const closingMap = new Map<number, InventoryItem>();
      closingInventoryData
        .filter(item => item.stockGroupId === selectedGroup.groupId)
        .forEach(item => closingMap.set(item.stockItemId, item));

      // Start with all closing items
      const result: InventoryItem[] = [...closingMap.values()];

      // Add opening-only items (sold out by close date) with qty=0
      openingInventoryData
        .filter(item => item.stockGroupId === selectedGroup.groupId && !closingMap.has(item.stockItemId))
        .forEach(item => result.push({ ...item, quantity: "0", totalValue: "0", averageRate: "0" }));

      return result
        .sort((a, b) => (a.stockItemName ?? "").localeCompare(b.stockItemName ?? ""))
        .filter(item =>
          (item.stockItemName ?? "").toLowerCase().includes(itemSearchTerm.toLowerCase()) ||
          (item.stockItemCode ?? "").toLowerCase().includes(itemSearchTerm.toLowerCase())
        );
    }

    return inventory
      .filter(item => item.stockGroupId === selectedGroup.groupId)
      .sort((a, b) => (a.stockItemName ?? "").localeCompare(b.stockItemName ?? ""))
      .filter(item =>
        (item.stockItemName ?? "").toLowerCase().includes(itemSearchTerm.toLowerCase()) ||
        (item.stockItemCode ?? "").toLowerCase().includes(itemSearchTerm.toLowerCase())
      );
  })();

  // Handle location selection
  const handleLocationClick = async (location: Location) => {
    setSelectedLocationLocal(location);
    setSelectedGroup(null);
  };

  // Handle selecting a location for use in POS/other modules
  const handleUseLocation = async (location: Location) => {
    setSelectedLocation(location);
    navigate("/pos");
  };

  // Handle back to locations
  const handleBackToLocations = async () => {
    setSelectedLocationLocal(null);
    setSelectedGroup(null);
    setViewAllItems(false);
    setShowAllStock(false);
    setAllStockSearchTerm("");
    setAllStockGroupFilter("");
    setAllStockLocationFilter("");
  };

  // Handle back to groups
  const handleBackToGroups = async () => {
    setSelectedGroup(null);
    setViewAllItems(false);
    setSelectedRowIndex(0);
    setItemSearchTerm("");
  };

  const escapeBackHandler = selectedGroup
    ? handleBackToGroups
    : selectedLocationLocal
      ? handleBackToLocations
      : showAllStock
        ? handleBackToLocations
        : null;
  useEscapeBack(escapeBackHandler);

  // Keyboard navigation for table
  useEffect(() => {
    if (!selectedGroup) return;

    const handleKeyDown = async (e: KeyboardEvent) => {
      if (hasAnyOpenDialog()) return;
      const itemCount = selectedGroup.items.length;
      if (itemCount === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedRowIndex((prev) => (prev + 1) % itemCount);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedRowIndex((prev) => (prev - 1 + itemCount) % itemCount);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedGroup]);

  // Reset selected row when group changes
  useEffect(() => {
    setSelectedRowIndex(0);
  }, [selectedGroup]);

  useEffect(() => {
    if (!selectedGroup || selectedGroup.items.length === 0) {
      clearCursorNav();
      return;
    }
    const itemCount = selectedGroup.items.length;
    registerCursorNav({
      canNavigateUp: itemCount > 0,
      canNavigateDown: itemCount > 0,
      onUp: () => setSelectedRowIndex(prev => (prev - 1 + itemCount) % itemCount),
      onDown: () => setSelectedRowIndex(prev => (prev + 1) % itemCount),
    });
    return () => clearCursorNav();
  }, [selectedGroup, selectedRowIndex]);

  // Import handlers
  const downloadImportTemplate = async () => {
    const template = [
      { Item_barcode: "BALE001", stockGroupCode: "FABRIC", quantity: "100", rate: "150.00", value: "15000.00" },
      { Item_barcode: "BALE002", stockGroupCode: "TEXTILE", quantity: "50", rate: "145.50", value: "7275.00" },
    ];

    const ws = utils.json_to_sheet(template);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Inventory Import");
    await writeFile(wb, "inventory_import_template.xlsx");

    toast({
      title: "Template Downloaded",
      description: "Use this template to prepare your inventory data",
    });
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setImportFile(selectedFile);
    setImportErrors([]);
    setImportPreview([]);
    setImportComplete(false);

    try {
      const data = await selectedFile.arrayBuffer();
      const workbook = await read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = utils.sheet_to_json<any>(worksheet);

      // Validate file has data
      if (jsonData.length === 0) {
        toast({
          title: "Empty File",
          description: "The Excel file is empty. Please add data rows and try again.",
          variant: "destructive",
        });
        return;
      }

      // Read header row explicitly to get all column names (avoids issues with blank first-row cells)
      const headerRow = utils.sheet_to_json<string[]>(worksheet, { header: 1 })[0] || [];
      const columns = headerRow.map((h: any) => String(h || "").trim());
      const requiredCols = ["Item_barcode", "quantity", "rate"];
      const missingCols = requiredCols.filter(col => !columns.includes(col));
      
      if (missingCols.length > 0) {
        toast({
          title: "Missing Required Columns",
          description: `Expected columns: ${requiredCols.join(", ")}. Found: ${columns.slice(0, 5).join(", ")}${columns.length > 5 ? "..." : ""}. Download the template to see expected format.`,
          variant: "destructive",
        });
        return;
      }

      const errors: string[] = [];
      const rows: ImportRow[] = [];

      jsonData.forEach((row, index) => {
        const rowNumber = index + 2;

        if (!row.Item_barcode || String(row.Item_barcode).trim() === "") {
          errors.push(`Row ${rowNumber}: Item_barcode is required`);
        }

        // Allow negative quantities and rates for opening balances from old systems
        if (row.quantity === undefined || row.quantity === null || row.quantity === "") {
          errors.push(`Row ${rowNumber}: Quantity is required`);
        }

        if (row.rate === undefined || row.rate === null || row.rate === "") {
          errors.push(`Row ${rowNumber}: Rate is required`);
        }

        rows.push({
          Item_barcode: String(row.Item_barcode || "").trim(),
          stockGroupCode: row.stockGroupCode ? String(row.stockGroupCode).trim() : undefined,
          quantity: String(row.quantity || "0"),
          rate: String(row.rate || "0"),
          value: String(row.value || "0"),
        });
      });

      setImportPreview(rows);
      setImportErrors(errors);

      if (errors.length === 0) {
        toast({
          title: "File Validated",
          description: `${rows.length} inventory items ready to import`,
        });
      } else {
        toast({
          title: "Validation Errors Found",
          description: `Found ${errors.length} errors. Please fix them before importing.`,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error Reading File",
        description: "Please ensure the file is a valid Excel file (.xlsx)",
        variant: "destructive",
      });
    }
  };

  const handleImportSubmit = async () => {
    if (!selectedLocationLocal) {
      toast({
        title: "No Location Selected",
        description: "Please select a location first",
        variant: "destructive",
      });
      return;
    }

    if (importErrors.length > 0) {
      toast({
        title: "Cannot Import",
        description: "Please fix validation errors first",
        variant: "destructive",
      });
      return;
    }

    setIsImporting(true);

    try {
      await apiRequest("POST", `/api/locations/${selectedLocationLocal.id}/import-inventory`, {
        items: importPreview,
      });

      queryClient.invalidateQueries({ queryKey: [`/api/locations/${selectedLocationLocal.id}/inventory`] });

      setImportComplete(true);
      toast({
        title: "Import Successful",
        description: `Successfully imported ${importPreview.length} inventory items`,
      });
    } catch (error: any) {
      toast({
        title: "Import Failed",
        description: error.message || "Failed to import inventory",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportDialogClose = async () => {
    setImportDialogOpen(false);
    setImportFile(null);
    setImportPreview([]);
    setImportErrors([]);
    setImportComplete(false);
  };

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

      // Validate file has data
      if (jsonData.length === 0) {
        toast({
          title: "Empty File",
          description: "The Excel file is empty. Please add data rows and try again.",
          variant: "destructive",
        });
        return;
      }

      // Read header row explicitly to get all column names (avoids issues with blank first-row cells)
      const headerRow = utils.sheet_to_json<string[]>(worksheet, { header: 1 })[0] || [];
      const columns = headerRow.map((h: any) => String(h || "").trim());
      const requiredCols = ["barcode", "costPrice"];
      const missingCols = requiredCols.filter(col => !columns.includes(col));
      
      if (missingCols.length > 0) {
        toast({
          title: "Missing Required Columns",
          description: `Expected columns: ${requiredCols.join(", ")}. Found: ${columns.slice(0, 5).join(", ")}${columns.length > 5 ? "..." : ""}. Download the template to see expected format.`,
          variant: "destructive",
        });
        return;
      }

      const errors: string[] = [];
      const rows: Array<{ barcode: string; costPrice: number }> = [];

      jsonData.forEach((row, index) => {
        const rowNumber = index + 2;

        if (!row.barcode || String(row.barcode).trim() === "") {
          errors.push(`Row ${rowNumber}: Barcode is required`);
          return;
        }

        const costPrice = parseFloat(row.costPrice || "0");
        if (isNaN(costPrice) || costPrice <= 0) {
          errors.push(`Row ${rowNumber}: Cost price must be a valid number greater than 0`);
          return;
        }

        rows.push({
          barcode: String(row.barcode || "").trim(),
          costPrice: costPrice,
        });
      });

      setCostPricePreview(rows);
      setCostPriceErrors(errors);

      if (errors.length === 0) {
        toast({
          title: "File Validated",
          description: `${rows.length} cost prices ready to import`,
        });
      } else {
        toast({
          title: "Validation Errors Found",
          description: `Found ${errors.length} errors. Please fix them before importing.`,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error Reading File",
        description: "Please ensure the file is a valid Excel file (.xlsx)",
        variant: "destructive",
      });
    }
  };

  const handleCostPriceImport = async () => {
    if (!selectedLocationLocal) {
      toast({
        title: "No Location Selected",
        description: "Please select a location first",
        variant: "destructive",
      });
      return;
    }

    if (costPriceErrors.length > 0) {
      toast({
        title: "Cannot Import",
        description: "Please fix validation errors first",
        variant: "destructive",
      });
      return;
    }

    setIsImportingCostPrice(true);

    try {
      const res = await apiRequest("POST", `/api/locations/${selectedLocationLocal.id}/import-cost-prices`, {
        updates: costPricePreview,
      });
      const response = await res.json();

      queryClient.invalidateQueries({ queryKey: [`/api/locations/${selectedLocationLocal.id}/inventory`] });

      setCostPriceImportComplete(true);
      toast({
        title: "Import Successful",
        description: `Updated ${response.updated} cost prices. ${response.errors?.length > 0 ? `${response.errors.length} errors encountered.` : ""}`,
      });
    } catch (error: any) {
      toast({
        title: "Import Failed",
        description: error.message || "Failed to update cost prices",
        variant: "destructive",
      });
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

  const handleDeleteLocation = async () => {
    if (!selectedLocationLocal) return;

    setIsDeleting(true);
    try {
      await apiRequest("DELETE", `/api/locations/${selectedLocationLocal.id}`);

      // Invalidate locations cache to refresh the list
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });

      toast({
        title: "Location Deleted",
        description: `${selectedLocationLocal.name} has been deleted successfully`,
      });

      // Navigate back to location list
      setSelectedLocationLocal(null);
      setDeleteDialogOpen(false);
    } catch (error: any) {
      if (error?.name === "OfflineQueued") {
        toast({ title: "Saved offline", description: "Location delete queued — will sync when connected" });
        setDeleteDialogOpen(false);
        setIsDeleting(false);
        return;
      }
      toast({
        title: "Delete Failed",
        description: error.message || "Failed to delete location",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleArchiveStockGroup = async () => {
    if (!selectedLocationLocal || !selectedGroup) return;

    setIsArchiving(true);
    try {
      await apiRequest("POST", "/api/stock-group-archives", {
        locationId: selectedLocationLocal.id,
        stockGroupId: selectedGroup.groupId,
        notes: "Archived from Location Inventory page",
      });

      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-group-archives"] });
      queryClient.invalidateQueries({ queryKey: [`/api/locations/${selectedLocationLocal.id}/inventory`] });

      toast({
        title: "Stock Group Archived",
        description: `${selectedGroup.groupName} has been archived from ${selectedLocationLocal.name}. You can restore it from Orphaned Records.`,
      });

      setSelectedGroup(null);
      setArchiveDialogOpen(false);
    } catch (error: any) {
      if (error?.name === "OfflineQueued") {
        toast({ title: "Saved offline", description: "Archive queued — will sync when connected" });
        setArchiveDialogOpen(false);
        setIsArchiving(false);
        return;
      }
      toast({
        title: "Archive Failed",
        description: error.message || "Failed to archive stock group",
        variant: "destructive",
      });
    } finally {
      setIsArchiving(false);
    }
  };

  const handleExportNegativeStock = async () => {
    if (negativeStockData.length === 0) return;
    const wb = utils.book_new();
    const wsData = negativeStockData.map(item => ({
      "Location": item.locationName,
      "Item Code": item.code,
      "Item Name": item.name,
      "Qty": parseFloat(item.quantity),
      "Group": item.groupName || "Unassigned",
    }));
    const ws = utils.json_to_sheet(wsData);
    utils.book_append_sheet(wb, ws, "Negative Stock");
    await writeFile(wb, "negative_stock_all_locations.xlsx");
  };

  // ────────────────────────────────────────────────────────────
  // Export "All Stock — All Locations" view to Excel / PDF
  // ────────────────────────────────────────────────────────────
  const handleExportAllStockExcel = async (includeCost: boolean) => {
    if (filteredCombinedRows.length === 0) {
      toast({ title: "Nothing to export", description: "No stock rows available.", variant: "destructive" });
      return;
    }
    try {
      const ExcelJSLib = (await import("exceljs")).default;
      const wb = new ExcelJSLib.Workbook();
      wb.creator = "ERP";
      wb.created = new Date();
      const ws = wb.addWorksheet("All Stock", {
        views: [{ state: "frozen", ySplit: 4, xSplit: 1 }],
      });

      const dateLabel = new Date().toLocaleDateString();
      const locCols = allInventoryLocations.map(l => l.name);
      const headers = ["Item Name", ...locCols, "Total Qty"];
      if (includeCost) headers.push("Avg Cost", "Total Value");
      const colCount = headers.length;

      // Title row
      ws.mergeCells(1, 1, 1, colCount);
      const title = ws.getCell(1, 1);
      title.value = "All Stock — All Locations";
      title.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
      title.alignment = { vertical: "middle", horizontal: "center" };
      title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
      ws.getRow(1).height = 26;

      // Subtitle row
      ws.mergeCells(2, 1, 2, colCount);
      const sub = ws.getCell(2, 1);
      sub.value = `${filteredCombinedRows.length} items · ${allInventoryLocations.length} locations · Generated ${dateLabel}`;
      sub.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF555555" } };
      sub.alignment = { vertical: "middle", horizontal: "center" };
      ws.getRow(2).height = 18;

      ws.addRow([]); // spacer

      // Header row
      const headerRow = ws.addRow(headers);
      headerRow.eachCell(cell => {
        cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF305496" } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: "FF8EA9DB" } },
          bottom: { style: "thin", color: { argb: "FF8EA9DB" } },
          left: { style: "thin", color: { argb: "FF8EA9DB" } },
          right: { style: "thin", color: { argb: "FF8EA9DB" } },
        };
      });
      headerRow.height = 22;

      // Data rows, with group separators
      let lastGroup = "";
      let zebra = false;
      for (const row of filteredCombinedRows) {
        if (!allStockGroupFilter && row.stockGroupName !== lastGroup) {
          lastGroup = row.stockGroupName;
          const gr = ws.addRow([row.stockGroupName || "(Ungrouped)"]);
          ws.mergeCells(gr.number, 1, gr.number, colCount);
          const gc = gr.getCell(1);
          gc.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF1F4E78" } };
          gc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
          gc.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
          gr.height = 18;
          zebra = false;
        }
        const dataRow: (string | number)[] = [row.stockItemName];
        for (const loc of allInventoryLocations) {
          const q = row.qtyByLocation[loc.id];
          dataRow.push(q && q > 0 ? Number(q) : "");
        }
        dataRow.push(Number(row.totalQty));
        if (includeCost) {
          dataRow.push(row.avgCost > 0 ? Number(row.avgCost) : "");
          dataRow.push(row.totalValue > 0 ? Number(row.totalValue) : "");
        }
        const r = ws.addRow(dataRow);
        const fillColor = zebra ? "FFF2F2F2" : "FFFFFFFF";
        zebra = !zebra;
        r.eachCell((cell, colNum) => {
          cell.font = { name: "Calibri", size: 10 };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
          cell.border = { bottom: { style: "hair", color: { argb: "FFDDDDDD" } } };
          if (colNum === 1) {
            cell.alignment = { vertical: "middle", horizontal: "left" };
          } else {
            cell.alignment = { vertical: "middle", horizontal: "right" };
            const isCurrency = includeCost && (colNum === colCount || colNum === colCount - 1);
            cell.numFmt = isCurrency ? "#,##0.00" : "#,##0.##";
          }
          // Bold "Total Qty" col
          const totalQtyCol = 1 + locCols.length + 1;
          if (colNum === totalQtyCol) {
            cell.font = { name: "Calibri", size: 10, bold: true };
          }
        });
      }

      // Grand total footer
      const totalsRowData: (string | number)[] = [`TOTAL (${filteredCombinedRows.length} items)`];
      for (const loc of allInventoryLocations) {
        const t = filteredCombinedRows.reduce((s, r) => s + (r.qtyByLocation[loc.id] || 0), 0);
        totalsRowData.push(t > 0 ? Number(t) : "");
      }
      totalsRowData.push(Number(filteredCombinedRows.reduce((s, r) => s + r.totalQty, 0)));
      if (includeCost) {
        totalsRowData.push("");
        totalsRowData.push(Number(filteredCombinedRows.reduce((s, r) => s + r.totalValue, 0)));
      }
      const totalRow = ws.addRow(totalsRowData);
      totalRow.eachCell((cell, colNum) => {
        cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF305496" } };
        cell.alignment = { vertical: "middle", horizontal: colNum === 1 ? "left" : "right" };
        if (colNum > 1) {
          const isCurrency = includeCost && colNum === colCount;
          cell.numFmt = isCurrency ? "#,##0.00" : "#,##0.##";
        }
      });
      totalRow.height = 22;

      // Column widths
      ws.getColumn(1).width = 38;
      for (let i = 2; i <= colCount; i++) ws.getColumn(i).width = 14;

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `all_stock_${new Date().toISOString().slice(0, 10)}${includeCost ? "" : "_no_cost"}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Excel exported", description: `${filteredCombinedRows.length} items exported.` });
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    }
  };

  const handleExportAllStockPDF = async (includeCost: boolean) => {
    if (filteredCombinedRows.length === 0) {
      toast({ title: "Nothing to export", description: "No stock rows available.", variant: "destructive" });
      return;
    }
    try {
      const { jsPDF } = await import("jspdf");
      const autoTable = (await import("jspdf-autotable")).default;

      const locCols = allInventoryLocations.map(l => l.name);
      const head: string[] = ["Item Name", ...locCols, "Total Qty"];
      if (includeCost) head.push("Avg Cost", "Total Value");

      // Choose orientation based on column count for a prettier fit
      const orientation = head.length > 6 ? "landscape" : "portrait";
      const doc = new jsPDF({ orientation, unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();

      // Pretty title block
      doc.setFillColor(31, 78, 120);
      doc.rect(0, 0, pageWidth, 60, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("All Stock — All Locations", 36, 28);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(
        `${filteredCombinedRows.length} items · ${allInventoryLocations.length} locations · Generated ${new Date().toLocaleString()}`,
        36, 46
      );
      if (includeCost) {
        const grandTotal = filteredCombinedRows.reduce((s, r) => s + r.totalValue, 0);
        const txt = `Total value: ${formatAmount(grandTotal)}`;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text(txt, pageWidth - 36 - doc.getTextWidth(txt), 36);
      }

      const fmt = (n: number, decimals = 2) =>
        n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals });

      // Build rows with group separators
      const body: any[] = [];
      let lastGroup = "";
      for (const row of filteredCombinedRows) {
        if (!allStockGroupFilter && row.stockGroupName !== lastGroup) {
          lastGroup = row.stockGroupName;
          const groupRow: any[] = [{
            content: row.stockGroupName || "(Ungrouped)",
            colSpan: head.length,
            styles: {
              fillColor: [217, 225, 242],
              textColor: [31, 78, 120],
              fontStyle: "bold",
              fontSize: 9,
              halign: "left",
            },
          }];
          body.push(groupRow);
        }
        const r: any[] = [row.stockItemName];
        for (const loc of allInventoryLocations) {
          const q = row.qtyByLocation[loc.id];
          r.push(q && q > 0 ? fmt(q) : "—");
        }
        r.push({ content: fmt(row.totalQty), styles: { fontStyle: "bold" } });
        if (includeCost) {
          r.push(row.avgCost > 0 ? fmt(row.avgCost) : "—");
          r.push(row.totalValue > 0 ? fmt(row.totalValue) : "—");
        }
        body.push(r);
      }

      // Footer totals row
      const footerCells: any[] = [{
        content: `TOTAL (${filteredCombinedRows.length} items)`,
        styles: { fontStyle: "bold", halign: "left", fillColor: [48, 84, 150], textColor: [255, 255, 255] },
      }];
      for (const loc of allInventoryLocations) {
        const t = filteredCombinedRows.reduce((s, r) => s + (r.qtyByLocation[loc.id] || 0), 0);
        footerCells.push({
          content: t > 0 ? fmt(t) : "—",
          styles: { fontStyle: "bold", halign: "right", fillColor: [48, 84, 150], textColor: [255, 255, 255] },
        });
      }
      footerCells.push({
        content: fmt(filteredCombinedRows.reduce((s, r) => s + r.totalQty, 0)),
        styles: { fontStyle: "bold", halign: "right", fillColor: [48, 84, 150], textColor: [255, 255, 255] },
      });
      if (includeCost) {
        footerCells.push({
          content: "",
          styles: { fillColor: [48, 84, 150], textColor: [255, 255, 255] },
        });
        footerCells.push({
          content: fmt(filteredCombinedRows.reduce((s, r) => s + r.totalValue, 0)),
          styles: { fontStyle: "bold", halign: "right", fillColor: [48, 84, 150], textColor: [255, 255, 255] },
        });
      }
      body.push(footerCells);

      autoTable(doc, {
        head: [head],
        body,
        startY: 76,
        theme: "grid",
        styles: {
          font: "helvetica",
          fontSize: 8,
          cellPadding: 4,
          lineColor: [221, 221, 221],
          lineWidth: 0.4,
          textColor: [40, 40, 40],
        },
        headStyles: {
          fillColor: [48, 84, 150],
          textColor: [255, 255, 255],
          fontStyle: "bold",
          halign: "center",
          fontSize: 9,
        },
        alternateRowStyles: { fillColor: [248, 249, 251] },
        columnStyles: (() => {
          const styles: any = { 0: { halign: "left", cellWidth: "auto" } };
          for (let i = 1; i < head.length; i++) styles[i] = { halign: "right" };
          return styles;
        })(),
        margin: { left: 24, right: 24, top: 76, bottom: 30 },
        didDrawPage: (data: any) => {
          const str = `Page ${doc.getNumberOfPages()}`;
          doc.setFontSize(8);
          doc.setTextColor(120, 120, 120);
          doc.text(str, pageWidth - 36, doc.internal.pageSize.getHeight() - 14, { align: "right" });
        },
      });

      doc.save(`all_stock_${new Date().toISOString().slice(0, 10)}${includeCost ? "" : "_no_cost"}.pdf`);
      toast({ title: "PDF exported", description: `${filteredCombinedRows.length} items exported.` });
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    }
  };

  const handleExportInventory = async () => {
    if (!selectedLocationLocal) return;
    if (!navigator.onLine) { toast({ title: "Not available offline", description: "Exports require a connection", variant: "destructive" }); return; }
    try {
      const response = await fetch(
        `/api/locations/${selectedLocationLocal.id}/inventory/export`,
        { credentials: 'include' }
      );
      if (!response.ok) throw new Error('Failed to export inventory');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedLocationLocal.name}_inventory_${new Date().toLocaleDateString('en-CA')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({
        title: "Export Successful",
        description: `Inventory for ${selectedLocationLocal.name} exported to Excel`,
      });
    } catch (error: any) {
      toast({
        title: "Export Failed",
        description: error.message || "Failed to export inventory",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6 p-3 md:p-6 w-full min-w-0">
      <PageHeader 
        title="Location Inventory" 
        subtitle="Manage inventory across all locations"
      >
        {!posUser && (
          <Button
            variant={showNegativeStock ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setShowNegativeStock(!showNegativeStock);
              if (showNegativeStock) setNegativeSearchTerm("");
            }}
            data-testid="button-negative-stock"
            className="gap-1"
          >
            <AlertCircle className="h-4 w-4" />
            <span className="hidden sm:inline">Negative Stock</span>
            <span className="sm:hidden">-ve Stock</span>
          </Button>
        )}
      </PageHeader>

      {/* Date range filter bar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-md bg-muted/30 border">
        <div className="flex items-center gap-1.5 shrink-0 mr-1">
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Movement</span>
        </div>

        <div className="h-4 w-px bg-border shrink-0" />

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground shrink-0">From</span>
            <DatePickerInput
              value={fromDate}
              onChange={setFromDate}
              placeholder="Start date"
              className="w-52"
              data-testid="input-from-date"
            />
          </div>

          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground shrink-0">To</span>
            <DatePickerInput
              value={asOfDate}
              onChange={setAsOfDate}
              placeholder="End date"
              className="w-52"
              data-testid="input-to-date"
            />
          </div>
        </div>

        {showMovement && (
          <Badge variant="secondary" className="text-xs gap-1 shrink-0">
            <TrendingUp className="h-3 w-3" />
            Movement Mode
          </Badge>
        )}

        {showMovement && (openingInventoryLoading || closingInventoryLoading || isFetching) && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
        )}

        {(fromDate || asOfDate) && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { setFromDate(""); setAsOfDate(""); }}
            data-testid="button-clear-dates"
            className="shrink-0 ml-auto"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      {showNegativeStock && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-lg sm:text-xl" data-testid="text-negative-stock-title">Negative Stock (All Locations)</CardTitle>
                <CardDescription>Items with negative inventory across all locations</CardDescription>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportNegativeStock}
                  disabled={negativeStockData.length === 0}
                  data-testid="button-export-negative-stock"
                >
                  <Download className="h-4 w-4 mr-1" />
                  Export
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setShowNegativeStock(false); setNegativeSearchTerm(""); }}
                  data-testid="button-close-negative-stock"
                >
                  <X className="h-4 w-4 mr-1" />
                  Close
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by code, name, or location..."
                value={negativeSearchTerm}
                onChange={(e) => setNegativeSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-negative-stock"
              />
            </div>

            {negativeStockLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : negativeStockData.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground" data-testid="text-no-negative-stock">
                No negative stock found across any location.
              </div>
            ) : (
              <>
                <div className="text-sm text-muted-foreground mb-2" data-testid="text-negative-stock-count">
                  Found {negativeStockData.length} item(s) with negative stock
                </div>
                <div className="table-responsive rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Location</TableHead>
                        <TableHead>Item Code</TableHead>
                        <TableHead>Item Name</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="hidden sm:table-cell">Group</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {negativeStockData.map((item: any, idx: number) => (
                        <TableRow key={`${item.locationId}-${item.stockItemId}`} data-testid={`row-negative-stock-${idx}`}>
                          <TableCell className="font-medium">{item.locationName}</TableCell>
                          <TableCell className="font-mono text-xs">{item.code}</TableCell>
                          <TableCell>{item.name}</TableCell>
                          <TableCell className="text-right text-destructive font-mono">
                            {parseFloat(item.quantity).toLocaleString()}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-muted-foreground">{item.groupName || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
      {!showNegativeStock && (
      <>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <MapPin className="w-4 h-4" />
        {!selectedLocationLocal && !showAllStock && <span>Select Location</span>}
        {showAllStock && !selectedLocationLocal && (
          <>
            <Button
              variant="ghost"
              onClick={handleBackToLocations}
              className="h-auto p-0 text-sm hover:underline"
              data-testid="button-back-from-all-stock"
            >
              Locations
            </Button>
            <ChevronRight className="w-4 h-4" />
            <span>All Stock (All Locations)</span>
          </>
        )}
        {selectedLocationLocal && !selectedGroup && !viewAllItems && (
          <>
            {(!posUser || locations.length > 1) && (
              <>
                <Button
                  variant="ghost"
                  onClick={handleBackToLocations}
                  className="h-auto p-0 text-sm hover:underline"
                  data-testid="button-back-to-locations"
                >
                  Locations
                </Button>
                <ChevronRight className="w-4 h-4" />
              </>
            )}
            <span>{selectedLocationLocal.name}</span>
          </>
        )}
        {selectedLocationLocal && viewAllItems && (
          <>
            {(!posUser || locations.length > 1) && (
              <>
                <Button
                  variant="ghost"
                  onClick={handleBackToLocations}
                  className="h-auto p-0 text-sm hover:underline"
                  data-testid="button-back-to-locations-from-all"
                >
                  Locations
                </Button>
                <ChevronRight className="w-4 h-4" />
              </>
            )}
            <Button
              variant="ghost"
              onClick={handleBackToGroups}
              className="h-auto p-0 text-sm hover:underline"
              data-testid="button-back-to-groups-from-all"
            >
              {selectedLocationLocal.name}
            </Button>
            <ChevronRight className="w-4 h-4" />
            <span>All Stock Items</span>
          </>
        )}
        {selectedLocationLocal && selectedGroup && (
          <>
            {(!posUser || locations.length > 1) && (
              <>
                <Button
                  variant="ghost"
                  onClick={handleBackToLocations}
                  className="h-auto p-0 text-sm hover:underline"
                  data-testid="button-back-to-locations-2"
                >
                  Locations
                </Button>
                <ChevronRight className="w-4 h-4" />
              </>
            )}
            <Button
              variant="ghost"
              onClick={handleBackToGroups}
              className="h-auto p-0 text-sm hover:underline"
              data-testid="button-back-to-groups"
            >
              {selectedLocationLocal.name}
            </Button>
            <ChevronRight className="w-4 h-4" />
            <span>{selectedGroup.groupName}</span>
          </>
        )}
      </div>

      {/* Location List View */}
      {!selectedLocationLocal && !showAllStock && (
        <div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
            <h1 className="text-xl md:text-3xl font-bold">Location Inventory</h1>
            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
              {!posUser && (
                <Button
                  variant="outline"
                  onClick={() => setShowAllStock(true)}
                  data-testid="button-view-all-stock"
                  className="gap-2 flex-1 sm:flex-none"
                >
                  <Globe className="w-4 h-4" />
                  View All Stock
                </Button>
              )}
              {!posUser && (
                <Button
                  variant="default"
                  onClick={() => setCreateLocationDialogOpen(true)}
                  data-testid="button-create-location"
                  className="gap-2 flex-1 sm:flex-none"
                >
                  <MapPin className="w-4 h-4" />
                  Create Location
                </Button>
              )}
            </div>
          </div>

          <LocationCreateDialog
            open={createLocationDialogOpen}
            onOpenChange={setCreateLocationDialogOpen}
          />
          
          {/* Search */}
          <div className="relative mb-6">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Search locations..."
              value={locationSearchTerm}
              onChange={(e) => setLocationSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search-locations"
            />
          </div>

          {locationsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
            </div>
          ) : filteredLocations.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              {locationSearchTerm ? "No locations match your search." : "No locations found. Create a location first."}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredLocations.map((location) => (
                <div
                  key={location.id}
                  className="bg-card border rounded-xl p-4 cursor-pointer hover-elevate flex items-center gap-4"
                  onClick={() => handleLocationClick(location)}
                  data-testid={`row-location-${location.id}`}
                >
                  <div className="flex-shrink-0 w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Warehouse className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-base truncate" data-testid={`name-${location.id}`}>{location.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Tap to view inventory</p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => openRenameDialog(location, e)}
                      data-testid={`button-rename-location-${location.id}`}
                      title="Rename location"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {!posUser && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => openWaGroupDialog(location, e)}
                        data-testid={`button-wa-group-location-${location.id}`}
                        title={(location as any).whatsappGroupChatId ? "Change WhatsApp group" : "Set WhatsApp group"}
                      >
                        <MessageCircle className={`h-4 w-4 ${(location as any).whatsappGroupChatId ? "text-green-600 dark:text-green-400" : ""}`} />
                      </Button>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* View All Stock — cross-location table */}
      {showAllStock && !selectedLocationLocal && (
        <div>
          {/* Page header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Globe className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold leading-tight">All Stock</h1>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">All Locations</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="gap-2"
                    disabled={filteredCombinedRows.length === 0}
                    data-testid="button-allstock-export"
                  >
                    <Download className="w-4 h-4" />
                    Export
                    <ChevronDown className="w-4 h-4 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Excel (.xlsx)
                  </div>
                  <DropdownMenuItem
                    onClick={() => handleExportAllStockExcel(true)}
                    data-testid="menu-export-excel-with-cost"
                  >
                    <FileSpreadsheet className="w-4 h-4 mr-2 text-green-600" />
                    With cost values
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleExportAllStockExcel(false)}
                    data-testid="menu-export-excel-no-cost"
                  >
                    <FileSpreadsheet className="w-4 h-4 mr-2 text-green-600/60" />
                    Without cost (qty only)
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    PDF (.pdf)
                  </div>
                  <DropdownMenuItem
                    onClick={() => handleExportAllStockPDF(true)}
                    data-testid="menu-export-pdf-with-cost"
                  >
                    <Printer className="w-4 h-4 mr-2 text-red-600" />
                    With cost values
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleExportAllStockPDF(false)}
                    data-testid="menu-export-pdf-no-cost"
                  >
                    <Printer className="w-4 h-4 mr-2 text-red-600/60" />
                    Without cost (qty only)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                onClick={() => setShowAllStock(false)}
                data-testid="button-back-from-all-stock-header"
                className="gap-2"
              >
                <X className="w-4 h-4" />
                Back to Locations
              </Button>
            </div>
          </div>

          {/* Stats bar */}
          {!allInventoryLoading && filteredCombinedRows.length > 0 && (
            <div className="flex flex-wrap gap-3 mb-4">
              <div className="flex items-center gap-2 bg-muted/60 rounded-lg px-3 py-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{filteredCombinedRows.length.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">Items</span>
              </div>
              <div className="flex items-center gap-2 bg-muted/60 rounded-lg px-3 py-2">
                <Warehouse className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{allInventoryLocations.length.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">Locations</span>
              </div>
              {!posUser && (
                <div className="flex items-center gap-2 bg-primary/10 rounded-lg px-3 py-2">
                  <span className="text-sm font-semibold font-mono text-primary">{formatAmount(filteredCombinedRows.reduce((s, r) => s + r.totalValue, 0))}</span>
                  <span className="text-xs text-muted-foreground">total value</span>
                </div>
              )}
            </div>
          )}

          <Card className="w-full">
            {/* Filters row */}
            <div className="flex flex-col sm:flex-row flex-wrap gap-3 p-4 border-b">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search items by name or code..."
                  value={allStockSearchTerm}
                  onChange={(e) => setAllStockSearchTerm(e.target.value)}
                  className="pl-10"
                  data-testid="input-all-stock-search"
                />
              </div>
              <Select
                value={allStockGroupFilter || "__all__"}
                onValueChange={(v) => setAllStockGroupFilter(v === "__all__" ? "" : v)}
              >
                <SelectTrigger className="w-full sm:w-48" data-testid="select-all-stock-group">
                  <SelectValue placeholder="All Groups" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Groups</SelectItem>
                  {allInventoryGroups.map((g) => (
                    <SelectItem key={String(g.id)} value={g.id === null ? "null" : String(g.id)}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={allStockLocationFilter || "__all__"}
                onValueChange={(v) => setAllStockLocationFilter(v === "__all__" ? "" : v)}
              >
                <SelectTrigger className="w-full sm:w-48" data-testid="select-all-stock-location">
                  <SelectValue placeholder="All Locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Locations</SelectItem>
                  {allInventoryLocations.map((loc) => (
                    <SelectItem key={String(loc.id)} value={String(loc.id)}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {allInventoryLoading ? (
              <div className="p-4 space-y-2">
                {[1,2,3,4,5].map((i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : filteredCombinedRows.length === 0 ? (
              <EmptyState
                icon={Package}
                title={allInventoryData.length === 0 ? "No stock found" : "No matching items"}
                description={allInventoryData.length === 0 ? "Stock has not been recorded across any location yet." : "Try adjusting your search to see other items."}
              />
            ) : (
              <div className="w-full overflow-auto max-h-[calc(100vh-200px)]">
                <table className="w-full text-sm border-collapse">
                  <thead className="sticky top-0 z-30 bg-muted/50">
                    <tr className="bg-muted/60 border-b">
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap sticky left-0 bg-muted/60 z-10">
                        Item Name
                      </th>
                      {allInventoryLocations.map((loc) => (
                        <th key={loc.id} className="text-right px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">
                          {loc.name}
                        </th>
                      ))}
                      <th className="text-right px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap border-l">
                        Total
                      </th>
                      <th className="text-right px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">
                        Avg Cost
                      </th>
                      <th className="text-right px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">
                        Total Value
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(() => {
                      const rows: JSX.Element[] = [];
                      let lastGroup = "";
                      for (const row of filteredCombinedRows) {
                        // Group separator when group changes
                        if (!allStockGroupFilter && row.stockGroupName !== lastGroup) {
                          lastGroup = row.stockGroupName;
                          const groupRows = filteredCombinedRows.filter(r => r.stockGroupName === row.stockGroupName);
                          const groupTotal = groupRows.reduce((s, r) => s + r.totalQty, 0);
                          const groupValue = groupRows.reduce((s, r) => s + r.totalValue, 0);
                          rows.push(
                            <tr key={`group-${row.stockGroupName}`} className="bg-muted/30">
                              <td
                                colSpan={allInventoryLocations.length + 4}
                                className="px-4 py-1.5 sticky left-0 bg-muted/30 z-10"
                              >
                                <div className="flex items-center justify-between gap-4">
                                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                    {row.stockGroupName}
                                    <span className="ml-2 font-normal normal-case text-muted-foreground/70">
                                      ({groupRows.length} item{groupRows.length !== 1 ? "s" : ""})
                                    </span>
                                  </span>
                                  <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                                    {groupTotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} units
                                    {groupValue > 0 && (
                                      <span className="ml-3">{formatAmount(groupValue)}</span>
                                    )}
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        }
                        rows.push(
                          <tr
                            key={row.stockItemId}
                            className="hover-elevate"
                            data-testid={`row-allstock-${row.stockItemId}`}
                          >
                            <td className="px-4 py-2 font-medium whitespace-nowrap sticky left-0 bg-background z-10">
                              {row.stockItemName}
                            </td>
                            {allInventoryLocations.map((loc) => (
                              <td key={loc.id} className="px-4 py-2 text-right font-mono whitespace-nowrap text-muted-foreground">
                                {row.qtyByLocation[loc.id] != null && row.qtyByLocation[loc.id] > 0
                                  ? row.qtyByLocation[loc.id].toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
                                  : <span className="text-muted-foreground/30">—</span>}
                              </td>
                            ))}
                            <td className="px-4 py-2 text-right font-mono font-semibold whitespace-nowrap border-l">
                              {row.totalQty.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">
                              {row.avgCost > 0 ? formatAmount(row.avgCost) : <span className="text-muted-foreground/30">—</span>}
                            </td>
                            <td className="px-4 py-2 text-right font-mono whitespace-nowrap">
                              {row.totalValue > 0 ? (
                                <span className="font-medium">{formatAmount(row.totalValue)}</span>
                              ) : (
                                <span className="text-muted-foreground/30">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      }
                      return rows;
                    })()}
                  </tbody>
                  {/* Grand total footer */}
                  <tfoot>
                    <tr className="bg-muted/50 border-t-2 font-semibold">
                      <td className="px-4 py-2.5 whitespace-nowrap sticky left-0 bg-muted/50 z-10">
                        Total ({filteredCombinedRows.length} items)
                      </td>
                      {allInventoryLocations.map((loc) => {
                        const locTotal = filteredCombinedRows.reduce((s, r) => s + (r.qtyByLocation[loc.id] || 0), 0);
                        return (
                          <td key={loc.id} className="px-4 py-2.5 text-right font-mono whitespace-nowrap text-muted-foreground">
                            {locTotal > 0
                              ? locTotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
                              : <span className="opacity-30">—</span>}
                          </td>
                        );
                      })}
                      <td className="px-4 py-2.5 text-right font-mono whitespace-nowrap border-l">
                        {filteredCombinedRows.reduce((s, r) => s + r.totalQty, 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono whitespace-nowrap text-muted-foreground">
                        —
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono whitespace-nowrap">
                        {formatAmount(filteredCombinedRows.reduce((s, r) => s + r.totalValue, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Stock Group List View */}
      {selectedLocationLocal && !selectedGroup && !viewAllItems && (
        <div>
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Warehouse className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl md:text-2xl font-bold leading-tight">
                    {selectedLocationLocal.name}
                  </h1>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => openRenameDialog(selectedLocationLocal, e)}
                    data-testid="button-rename-selected-location"
                    title="Rename location"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {!posUser && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => openWaGroupDialog(selectedLocationLocal, e)}
                      data-testid="button-wa-group-selected-location"
                      title={(selectedLocationLocal as any).whatsappGroupChatId ? "Change WhatsApp group" : "Set WhatsApp group"}
                    >
                      <MessageCircle className={`h-4 w-4 ${(selectedLocationLocal as any).whatsappGroupChatId ? "text-green-600 dark:text-green-400" : ""}`} />
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Stock Groups</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap w-full md:w-auto">
              {/* Export dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-2 flex-1 md:flex-none" data-testid="button-export-dropdown">
                    <Download className="w-4 h-4" />
                    Export
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => handleExportInventory()} data-testid="button-export-excel">
                    <Download className="w-4 h-4 mr-2" />
                    Export to Excel
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {!posUser && (
                    <DropdownMenuItem onClick={() => handlePrintWithOption(true)} data-testid="button-export-pdf-with-cost">
                      <Printer className="w-4 h-4 mr-2" />
                      Export to PDF (with cost)
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => handlePrintWithOption(false)} data-testid="button-export-pdf-no-cost">
                    <Printer className="w-4 h-4 mr-2" />
                    Export to PDF (without cost)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                onClick={() => setViewAllItems(true)}
                data-testid="button-view-all-items"
                variant="outline"
                className="gap-2 flex-1 md:flex-none"
              >
                <List className="w-4 h-4" />
                <span className="hidden sm:inline">View All Stock Items</span>
                <span className="sm:hidden">View All</span>
              </Button>

              <Button
                onClick={() => setShowZeroStock(v => !v)}
                data-testid="button-show-zero-stock"
                variant={showZeroStock ? "default" : "outline"}
                className="gap-2 flex-1 md:flex-none"
              >
                <Eye className="w-4 h-4" />
                <span className="hidden sm:inline">{showZeroStock ? "Hide zero stock" : "Show zero stock"}</span>
                <span className="sm:hidden">Zero</span>
              </Button>

              {!posUser && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="gap-2 flex-1 md:flex-none" data-testid="button-location-actions-dropdown">
                      Location
                      <ChevronDown className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => handleUseLocation(selectedLocationLocal)}
                      data-testid="button-use-location"
                    >
                      <ShoppingCart className="w-4 h-4 mr-2" />
                      Use Location for POS
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setDeleteDialogOpen(true)}
                      data-testid="button-delete-location"
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete Location
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          {/* Stats bar */}
          {!inventoryLoading && stockGroups.length > 0 && (
            <div className="flex flex-wrap gap-3 mb-4">
              <div className="flex items-center gap-2 bg-muted/60 rounded-lg px-3 py-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{stockGroups.length}</span>
                <span className="text-xs text-muted-foreground">Groups</span>
              </div>
              <div className="flex items-center gap-2 bg-muted/60 rounded-lg px-3 py-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{stockGroups.reduce((s, g) => s + g.itemCount, 0).toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">Items</span>
              </div>
              <div className="flex items-center gap-2 bg-muted/60 rounded-lg px-3 py-2">
                <span className="text-sm font-semibold font-mono">{Math.floor(stockGroups.reduce((s, g) => s + g.totalQuantity, 0)).toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">BL total</span>
              </div>
              {!posUser && (
                <div className="flex items-center gap-2 bg-primary/10 rounded-lg px-3 py-2">
                  <span className="text-sm font-semibold font-mono text-primary">{formatAmount(stockGroups.reduce((s, g) => s + g.totalValue, 0))}</span>
                  <span className="text-xs text-muted-foreground">total value</span>
                </div>
              )}
            </div>
          )}

          {/* Delete Confirmation Dialog */}
          <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Location</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete "{selectedLocationLocal?.name}"? This action cannot be undone and will remove all associated inventory data.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteLocation}
                  disabled={isDeleting}
                  data-testid="button-confirm-delete"
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isDeleting ? "Deleting..." : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Card className="p-4 w-full overflow-hidden">
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                placeholder="Search stock groups by name..."
                value={groupSearchTerm}
                onChange={(e) => setGroupSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-groups"
              />
            </div>

            {!inventoryLoading && unassignedInventoryItems.length > 0 && (
              <div className="mb-4 flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-50 dark:bg-yellow-950/20 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300">
                <span className="font-medium">Warning:</span>
                <span>{unassignedInventoryItems.length} item{unassignedInventoryItems.length > 1 ? "s have" : " has"} no Stock Group assigned and {unassignedInventoryItems.length > 1 ? "are" : "is"} hidden. Please go to Stock Items and assign a group to {unassignedInventoryItems.length > 1 ? "them" : "it"}.</span>
              </div>
            )}

            {inventoryLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : stockGroups.length === 0 && unassignedInventoryItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p className="font-medium mb-1">No inventory found at this location.</p>
                <p className="text-xs">Create Stock Groups and Stock Items first, then import or receive stock.</p>
              </div>
            ) : stockGroups.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                All items at this location are unassigned. See the warning above.
              </div>
            ) : (
              <>
                {/* Mobile card view */}
                <div className="md:hidden space-y-2">
                {filteredStockGroups.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No stock groups found matching your search
                  </div>
                ) : (
                  <>
                    {filteredStockGroups.map((group) => {
                      const closingQty = group.totalQuantity;
                      const openingQty = showMovement ? (openingGroupQtyMap.get(group.groupId!) || 0) : 0;
                      const movement = closingQty - openingQty;
                      const isNegative = closingQty < 0;
                      return (
                        <div
                          key={group.groupId || 0}
                          className={`bg-card border rounded-xl p-4 cursor-pointer hover-elevate flex items-center gap-3 ${isNegative ? "border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30" : ""}`}
                          onClick={() => setSelectedGroup(group)}
                          data-testid={`row-group-${group.groupId || 'uncategorized'}`}
                        >
                          <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Layers className="h-4 w-4 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm leading-snug truncate" data-testid={`name-${group.groupId}`}>{group.groupName}</p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <Badge variant="secondary" className="text-xs font-mono" data-testid={`items-${group.groupId}`}>
                                {group.itemCount.toLocaleString()} items
                              </Badge>
                              {showMovement ? (
                                <span className={`text-xs font-mono font-semibold ${movement < 0 ? "text-red-600" : movement > 0 ? "text-green-600" : "text-muted-foreground"}`}>
                                  {movement > 0 ? <TrendingUp className="inline h-3 w-3 mr-0.5" /> : movement < 0 ? <TrendingDown className="inline h-3 w-3 mr-0.5" /> : null}
                                  {movement > 0 ? "+" : ""}{Math.floor(movement).toLocaleString()} BL
                                </span>
                              ) : (
                                <span className={`text-xs font-mono font-semibold ${isNegative ? "text-red-600" : "text-muted-foreground"}`} data-testid={`qty-${group.groupId}`}>
                                  {Math.floor(closingQty).toLocaleString()} BL
                                </span>
                              )}
                            </div>
                          </div>
                          {!posUser && (
                            <div className="text-right flex-shrink-0">
                              <p className="text-sm font-semibold font-mono" data-testid={`value-${group.groupId}`}>{formatAmount(group.totalValue)}</p>
                              <p className="text-xs text-muted-foreground font-mono" data-testid={`rate-${group.groupId}`}>{formatAmount(group.averageRate)} avg</p>
                            </div>
                          )}
                          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        </div>
                      );
                    })}
                    {filteredStockGroups.length > 0 && !itemSearchTerm && (
                      <div className="bg-muted/50 border rounded-xl p-4 flex items-center justify-between">
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total</p>
                          <p className="text-sm font-semibold">{filteredStockGroups.reduce((sum, g) => sum + g.itemCount, 0).toLocaleString()} items</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-mono font-bold">{Math.floor(filteredStockGroups.reduce((sum, g) => sum + g.totalQuantity, 0)).toLocaleString()} BL</p>
                          {!posUser && (
                            <p className="text-sm font-mono font-semibold text-primary">{formatAmount(filteredStockGroups.reduce((sum, g) => sum + g.totalValue, 0))}</p>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Desktop table view */}
              <div className="w-full overflow-auto hidden md:block border-t -mx-4 -mb-4 max-h-[calc(100vh-200px)]" style={{ width: "calc(100% + 2rem)" }}>
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col className="w-[34%]" />
                    <col className="w-[12%]" />
                    {showMovement ? (
                      <>
                        <col className="w-[15%]" />
                        <col className="w-[15%]" />
                        <col className="w-[12%]" />
                      </>
                    ) : (
                      <col className="w-[18%]" />
                    )}
                    {!posUser && (
                      <>
                        <col className="w-[18%]" />
                        <col className="w-[18%]" />
                      </>
                    )}
                  </colgroup>
                  <thead className="bg-muted/50 sticky top-0 z-30">
                    <tr className="h-12">
                      <th className="text-left px-3 font-medium w-[34%]">Name</th>
                      <th className="text-right px-3 font-medium w-[12%]">Items</th>
                      {showMovement ? (
                        <>
                          <th className="text-right px-3 font-medium w-[15%]">Opening (BL)</th>
                          <th className="text-right px-3 font-medium w-[15%]">Closing (BL)</th>
                          <th className="text-right px-3 font-medium w-[12%]">Movement</th>
                        </>
                      ) : (
                        <th className={`text-right px-3 font-medium w-[18%] ${posUser ? "pr-6" : ""}`}>Total Qty (BL)</th>
                      )}
                      {!posUser && (
                        <>
                          <th className="text-right px-3 font-medium w-[18%]">Avg Rate</th>
                          <th className="text-right px-3 pr-6 font-medium w-[18%]">Total Value</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStockGroups.length === 0 ? (
                      <tr>
                        <td colSpan={posUser ? (showMovement ? 5 : 3) : (showMovement ? 7 : 5)} className="text-center py-8 text-muted-foreground">
                          No stock groups found matching your search
                        </td>
                      </tr>
                    ) : (
                      <>
                        {filteredStockGroups.map((group) => {
                          const closingQty = group.totalQuantity;
                          const openingQty = showMovement ? (openingGroupQtyMap.get(group.groupId!) || 0) : 0;
                          const movement = closingQty - openingQty;
                          const isNegative = closingQty < 0;
                          const isMovementNeg = movement < 0;
                          return (
                          <tr
                            key={group.groupId || 0}
                            className={`border-t cursor-pointer h-14 ${isNegative ? "bg-rose-50 dark:bg-rose-950/30" : "hover-elevate"}`}
                            onClick={() => setSelectedGroup(group)}
                            data-testid={`row-group-desktop-${group.groupId || 'uncategorized'}`}
                          >
                            <td className="px-3 font-medium min-w-0" data-testid={`name-desktop-${group.groupId}`}>
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                                  <Layers className="h-3.5 w-3.5 text-primary" />
                                </div>
                                <span className="truncate">{group.groupName}</span>
                              </div>
                            </td>
                            <td className="px-3 text-right" data-testid={`items-desktop-${group.groupId}`}>
                              <Badge variant="secondary" className="font-mono">
                                {group.itemCount.toLocaleString()}
                              </Badge>
                            </td>
                            {showMovement ? (
                              <>
                                <td className="px-3 text-right font-mono text-muted-foreground text-sm">
                                  {Math.floor(openingQty).toLocaleString()} BL
                                </td>
                                <td className={`px-3 text-right font-mono font-semibold ${isNegative ? "text-red-600" : ""}`}>
                                  {Math.floor(closingQty).toLocaleString()} BL
                                </td>
                                <td className={`px-3 text-right font-mono font-semibold ${isMovementNeg ? "text-red-600" : movement > 0 ? "text-green-600" : "text-muted-foreground"}`}>
                                  <span className="inline-flex items-center gap-1">
                                    {movement > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : movement < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : null}
                                    {movement > 0 ? "+" : ""}{Math.floor(movement).toLocaleString()} BL
                                  </span>
                                </td>
                              </>
                            ) : (
                              <td className={`px-3 text-right font-mono font-semibold ${isNegative ? "text-red-600" : ""}`} data-testid={`qty-desktop-${group.groupId}`}>
                                {Math.floor(closingQty).toLocaleString()}<span className="ml-2 text-xs font-normal text-muted-foreground">BL</span>
                              </td>
                            )}
                            {!posUser && (
                              <>
                                <td className="px-3 text-right font-mono text-sm text-muted-foreground" data-testid={`rate-desktop-${group.groupId}`}>
                                  {formatAmount(group.averageRate)}
                                </td>
                                <td className="px-3 text-right font-mono font-semibold" data-testid={`value-desktop-${group.groupId}`}>
                                  {formatAmount(group.totalValue)}
                                </td>
                              </>
                            )}
                          </tr>
                        );})}
                        {filteredStockGroups.length > 0 && !itemSearchTerm && (
                          <tr className="border-t h-12 bg-muted/50 font-bold">
                            <td className="px-3">Total</td>
                            <td className="px-3 text-right">{filteredStockGroups.reduce((sum, g) => sum + g.itemCount, 0).toLocaleString()}</td>
                            {showMovement ? (
                              <>
                                <td className="px-3 text-right font-mono text-muted-foreground">
                                  {Math.floor(filteredStockGroups.reduce((sum, g) => sum + (openingGroupQtyMap.get(g.groupId!) || 0), 0)).toLocaleString()} BL
                                </td>
                                <td className="px-3 text-right font-mono">
                                  {Math.floor(filteredStockGroups.reduce((sum, g) => sum + g.totalQuantity, 0)).toLocaleString()} BL
                                </td>
                                <td className="px-3 text-right font-mono">
                                  {(() => {
                                    const tot = filteredStockGroups.reduce((sum, g) => sum + g.totalQuantity - (openingGroupQtyMap.get(g.groupId!) || 0), 0);
                                    return `${tot > 0 ? "+" : ""}${Math.floor(tot).toLocaleString()} BL`;
                                  })()}
                                </td>
                              </>
                            ) : (
                              <td className="px-3 text-right font-mono">
                                {Math.floor(filteredStockGroups.reduce((sum, g) => sum + g.totalQuantity, 0)).toLocaleString()}<span className="ml-3">BL</span>
                              </td>
                            )}
                            {!posUser && (
                              <>
                                <td className="px-3 text-right font-mono"></td>
                                <td className="px-3 text-right font-mono">
                                  {formatAmount(filteredStockGroups.reduce((sum, g) => sum + g.totalValue, 0))}
                                </td>
                              </>
                            )}
                          </tr>
                        )}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
              </>
            )}
            {!inventoryLoading && filteredStockGroups.length > 0 && (
              <div className="mt-4 text-sm text-muted-foreground">
                Showing {filteredStockGroups.length} of {stockGroups.length} stock groups
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Stock Items Table View (Single Group) */}
      {selectedLocationLocal && selectedGroup && (
        <div>
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Layers className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold leading-tight">
                  {selectedGroup.groupName}
                </h1>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{selectedLocationLocal.name} · Stock Items</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap w-full md:w-auto">
              <Button
                onClick={() => setShowZeroStock(v => !v)}
                data-testid="button-show-zero-stock-items"
                variant={showZeroStock ? "default" : "outline"}
                className="gap-2 flex-1 sm:flex-none"
              >
                <Eye className="w-4 h-4" />
                <span>{showZeroStock ? "Hide zero stock" : "Show zero stock"}</span>
              </Button>
              {!posUser && (
                <Button
                  variant="outline"
                  onClick={() => setArchiveDialogOpen(true)}
                  data-testid="button-archive-stock-group"
                  className="gap-2 flex-1 sm:flex-none"
                >
                  <Archive className="h-4 w-4" />
                  Archive Stock Group
                </Button>
              )}
            </div>
          </div>

          {/* Stats bar */}
          {!inventoryLoading && filteredStockItems.length > 0 && (
            <div className="flex flex-wrap gap-3 mb-4">
              <div className="flex items-center gap-2 bg-muted/60 rounded-lg px-3 py-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{filteredStockItems.length.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">Items</span>
              </div>
              <div className="flex items-center gap-2 bg-muted/60 rounded-lg px-3 py-2">
                <span className="text-sm font-semibold font-mono">{Math.floor(filteredStockItems.reduce((s, i) => s + parseFloat(i.quantity || "0"), 0)).toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">BL total</span>
              </div>
              {!posUser && (
                <div className="flex items-center gap-2 bg-primary/10 rounded-lg px-3 py-2">
                  <span className="text-sm font-semibold font-mono text-primary">{formatAmount(filteredStockItems.reduce((s, i) => s + parseFloat(i.totalValue || "0"), 0))}</span>
                  <span className="text-xs text-muted-foreground">total value</span>
                </div>
              )}
            </div>
          )}

          <Card className="p-3 md:p-4 w-full overflow-hidden">
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                placeholder="Search items by name..."
                value={itemSearchTerm}
                onChange={(e) => setItemSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-items"
              />
            </div>

            {/* Mobile card view */}
            <div className="md:hidden space-y-2">
              {filteredStockItems.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {itemSearchTerm ? "No items found matching your search" : "No items in this group"}
                </div>
              ) : (
                <>
                  {filteredStockItems.map((item, index) => {
                    const closingQty = parseFloat(item.quantity || "0");
                    const openingQty = showMovement ? (openingInventoryMap.get(item.stockItemId) || 0) : 0;
                    const movement = closingQty - openingQty;
                    const isNegative = closingQty < 0;
                    const isSelected = index === selectedRowIndex;
                    return (
                      <div
                        key={item.inventoryId}
                        data-testid={`row-item-${item.stockItemId}`}
                        className={`bg-card border rounded-xl p-4 cursor-pointer hover-elevate ${
                          isSelected ? "ring-2 ring-primary" : ""
                        } ${isNegative ? "border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30" : ""}`}
                        onClick={() => setSelectedRowIndex(index)}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/locations/${item.locationId}/stock-items/${item.stockItemId}/history`);
                            }}
                            className="text-left text-primary hover:underline cursor-pointer font-semibold text-sm leading-snug flex-1"
                            data-testid={`link-item-${item.stockItemId}`}
                          >
                            <span className="flex items-center gap-2 flex-wrap">
                              {item.stockItemName}
                              {item.stockItemActive === false && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                            </span>
                          </button>
                          {!posUser && (
                            <span className="font-mono font-bold text-sm flex-shrink-0">{formatAmount(parseFloat(item.totalValue))}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                          {showMovement ? (
                            <>
                              <span className="text-xs text-muted-foreground font-mono">{Math.floor(openingQty).toLocaleString()} → <span className={`font-semibold ${isNegative ? "text-red-600" : "text-foreground"}`}>{Math.floor(closingQty).toLocaleString()}</span> BL</span>
                              <span className={`text-xs font-mono font-semibold inline-flex items-center gap-0.5 ${movement < 0 ? "text-red-600" : movement > 0 ? "text-green-600" : "text-muted-foreground"}`}>
                                {movement > 0 ? <TrendingUp className="h-3 w-3" /> : movement < 0 ? <TrendingDown className="h-3 w-3" /> : null}
                                {movement > 0 ? "+" : ""}{Math.floor(movement).toLocaleString()} BL
                              </span>
                            </>
                          ) : (
                            <span className={`text-sm font-mono font-semibold ${isNegative ? "text-red-600" : ""}`}>
                              {Math.floor(closingQty).toLocaleString()} <span className="text-xs font-normal text-muted-foreground">BL</span>
                            </span>
                          )}
                          {!posUser && (
                            <span className="text-xs text-muted-foreground font-mono ml-auto">{formatAmount(parseFloat(item.averageRate))} avg</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {filteredStockItems.length > 0 && (
                    <div className="bg-muted/50 border rounded-xl p-4 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total</p>
                        <p className="text-sm font-mono font-bold">{Math.floor(filteredStockItems.reduce((sum, item) => sum + parseFloat(item.quantity || "0"), 0)).toLocaleString()} BL</p>
                      </div>
                      {!posUser && (
                        <p className="text-sm font-mono font-semibold text-primary">{formatAmount(filteredStockItems.reduce((sum, item) => sum + parseFloat(item.totalValue || "0"), 0))}</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Desktop table view */}
            <div className="w-full overflow-auto hidden md:block border-t -mx-3 md:-mx-4 -mb-3 md:-mb-4 max-h-[calc(100vh-260px)]" style={{ width: "calc(100% + 2rem)" }}>
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col className="w-[46%]" />
                  {showMovement ? (
                    <>
                      <col className="w-[15%]" />
                      <col className="w-[15%]" />
                      <col className="w-[12%]" />
                    </>
                  ) : (
                    <col className="w-[18%]" />
                  )}
                  {!posUser && (
                    <>
                      <col className="w-[18%]" />
                      <col className="w-[18%]" />
                    </>
                  )}
                </colgroup>
                <thead className="bg-muted/50 sticky top-0 z-30">
                  <tr className="h-12">
                    <th className="text-left px-3 font-medium w-[46%]">Name</th>
                    {showMovement ? (
                      <>
                        <th className="text-right px-3 font-medium w-[15%]">Opening (BL)</th>
                        <th className="text-right px-3 font-medium w-[15%]">Closing (BL)</th>
                        <th className="text-right px-3 font-medium w-[12%]">Movement</th>
                      </>
                    ) : (
                      <th className={`text-right px-3 font-medium w-[18%] ${posUser ? "pr-6" : ""}`}>Quantity</th>
                    )}
                    {!posUser && (
                      <>
                        <th className="text-right px-3 font-medium w-[18%]">Avg Rate</th>
                        <th className="text-right px-3 pr-6 font-medium w-[18%]">Total Value</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredStockItems.length === 0 ? (
                    <tr>
                      <td colSpan={posUser ? (showMovement ? 4 : 2) : (showMovement ? 6 : 4)} className="text-center py-8 text-muted-foreground">
                        {itemSearchTerm ? "No items found matching your search" : "No items in this group"}
                      </td>
                    </tr>
                  ) : (
                    filteredStockItems.map((item, index) => {
                      const closingQty = parseFloat(item.quantity || "0");
                      const openingQty = showMovement ? (openingInventoryMap.get(item.stockItemId) || 0) : 0;
                      const movement = closingQty - openingQty;
                      const isNegative = closingQty < 0;
                      const isMovementNeg = movement < 0;
                      return (
                        <tr
                          key={item.inventoryId}
                          data-testid={`row-item-desktop-${item.stockItemId}`}
                          className={`border-t h-12 ${
                            index === selectedRowIndex 
                              ? (isNegative ? "bg-red-200 dark:bg-red-800/50 ring-2 ring-primary" : "bg-accent") 
                              : (isNegative ? "bg-rose-50 dark:bg-rose-950/30" : "hover-elevate")
                          }`}
                          onClick={() => setSelectedRowIndex(index)}
                        >
                          <td className="px-3 font-medium min-w-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/locations/${item.locationId}/stock-items/${item.stockItemId}/history`);
                              }}
                              className="text-left text-primary hover:underline cursor-pointer w-full min-w-0"
                              data-testid={`link-item-desktop-${item.stockItemId}`}
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <span className="truncate">{item.stockItemName}</span>
                                {item.stockItemActive === false && <Badge variant="outline" className="text-xs shrink-0">Inactive</Badge>}
                              </span>
                            </button>
                          </td>
                          {showMovement ? (
                            <>
                              <td className="px-3 text-right font-mono text-sm text-muted-foreground">
                                {Math.floor(openingQty).toLocaleString()} <span className="text-xs">BL</span>
                              </td>
                              <td className={`px-3 text-right font-mono font-semibold ${isNegative ? "text-red-600" : ""}`}>
                                {Math.floor(closingQty).toLocaleString()} <span className="text-xs font-normal text-muted-foreground">BL</span>
                              </td>
                              <td className={`px-3 text-right font-mono font-semibold ${isMovementNeg ? "text-red-600" : movement > 0 ? "text-green-600" : "text-muted-foreground"}`}>
                                <span className="inline-flex items-center justify-end gap-1">
                                  {movement > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : movement < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : null}
                                  {movement > 0 ? "+" : ""}{Math.floor(movement).toLocaleString()} <span className="text-xs font-normal">BL</span>
                                </span>
                              </td>
                            </>
                          ) : (
                            <td className={`px-3 text-right font-mono font-semibold ${isNegative ? "text-red-600" : ""}`}>
                              {Math.floor(closingQty).toLocaleString()}<span className="ml-2 text-xs font-normal text-muted-foreground">BL</span>
                            </td>
                          )}
                          {!posUser && (
                            <>
                              <td className="px-3 text-right font-mono text-sm text-muted-foreground">
                                {formatAmount(parseFloat(item.averageRate))}
                              </td>
                              <td className="px-3 text-right font-mono font-semibold">
                                {formatAmount(parseFloat(item.totalValue))}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {filteredStockItems.length > 0 && (
                  <tfoot className="bg-muted/50 border-t-2 font-semibold">
                    <tr className="h-12">
                      <td className="px-3 font-bold">Total</td>
                      {showMovement ? (
                        <>
                          <td className="px-3 text-right font-mono font-bold text-muted-foreground">
                            {Math.floor(filteredStockItems.reduce((sum, item) => sum + (openingInventoryMap.get(item.stockItemId) || 0), 0)).toLocaleString()} BL
                          </td>
                          <td className="px-3 text-right font-mono font-bold">
                            {Math.floor(filteredStockItems.reduce((sum, item) => sum + parseFloat(item.quantity || "0"), 0)).toLocaleString()} BL
                          </td>
                          <td className="px-3 text-right font-mono font-bold">
                            {(() => {
                              const tot = filteredStockItems.reduce((sum, item) => sum + parseFloat(item.quantity || "0") - (openingInventoryMap.get(item.stockItemId) || 0), 0);
                              return `${tot > 0 ? "+" : ""}${Math.floor(tot).toLocaleString()} BL`;
                            })()}
                          </td>
                        </>
                      ) : (
                        <td className="px-3 text-right font-mono font-bold">
                          {Math.floor(filteredStockItems.reduce((sum, item) => sum + parseFloat(item.quantity || "0"), 0)).toLocaleString()}<span className="ml-3">BL</span>
                        </td>
                      )}
                      {!posUser && (
                        <>
                          <td className="px-3"></td>
                          <td className="px-3 text-right font-mono font-bold">
                            {formatAmount(filteredStockItems.reduce((sum, item) => sum + parseFloat(item.totalValue || "0"), 0))}
                          </td>
                        </>
                      )}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {filteredStockItems.length > 0 && (
              <div className="mt-4 text-sm text-muted-foreground">
                Showing {filteredStockItems.length} of {inventory.filter(i => i.stockGroupId === selectedGroup.groupId).length} items
              </div>
            )}
          </Card>
        </div>
      )}

      {/* All Stock Items View */}
      {selectedLocationLocal && viewAllItems && (
        <div>
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Warehouse className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold leading-tight">
                  {selectedLocationLocal.name}
                </h1>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">All Stock Items</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap w-full md:w-auto">
              <Button
                onClick={() => setShowZeroStock(v => !v)}
                data-testid="button-show-zero-stock-all-items"
                variant={showZeroStock ? "default" : "outline"}
                className="gap-2 flex-1 sm:flex-none"
              >
                <Eye className="w-4 h-4" />
                <span>{showZeroStock ? "Hide zero stock" : "Show zero stock"}</span>
              </Button>
              <Button
                onClick={handleExportInventory}
                data-testid="button-export-all-stock-excel"
                variant="outline"
                className="gap-2 flex-1 sm:flex-none"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Export Excel
              </Button>
              <Button
                onClick={handlePrint}
                data-testid="button-print-inventory"
                variant="default"
                className="gap-2 flex-1 sm:flex-none"
              >
                <Printer className="w-4 h-4" />
                Print Inventory
              </Button>
            </div>
          </div>

          {/* Stats bar */}
          {!inventoryLoading && inventory.length > 0 && (
            <div className="flex flex-wrap gap-3 mb-4">
              <div className="flex items-center gap-2 bg-muted/60 rounded-lg px-3 py-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{stockGroups.length}</span>
                <span className="text-xs text-muted-foreground">Groups</span>
              </div>
              <div className="flex items-center gap-2 bg-muted/60 rounded-lg px-3 py-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{inventory.length.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">Items</span>
              </div>
              <div className="flex items-center gap-2 bg-muted/60 rounded-lg px-3 py-2">
                <span className="text-sm font-semibold font-mono">{Math.floor(inventory.reduce((s, i) => s + parseFloat(i.quantity || "0"), 0)).toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">BL total</span>
              </div>
              {!posUser && (
                <div className="flex items-center gap-2 bg-primary/10 rounded-lg px-3 py-2">
                  <span className="text-sm font-semibold font-mono text-primary">{formatAmount(inventory.reduce((s, i) => s + parseFloat(i.totalValue || "0"), 0))}</span>
                  <span className="text-xs text-muted-foreground">total value</span>
                </div>
              )}
            </div>
          )}

          {/* Search bar */}
          <div className="screen-only flex items-center gap-2 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search items by name or code..."
                value={itemSearchTerm}
                onChange={(e) => setItemSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-all-stock-items-search"
              />
            </div>
            {itemSearchTerm && (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setItemSearchTerm("")}
                data-testid="button-clear-all-stock-search"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Printable area */}
          <div ref={printRef}>
            <style>{`
              @page {
                size: A4;
                margin: 12mm 14mm;
              }
              @media print {
                body {
                  margin: 0;
                  font-family: Arial, Helvetica, sans-serif;
                  -webkit-print-color-adjust: exact;
                  print-color-adjust: exact;
                }
                .print-header {
                  margin-bottom: 10px !important;
                  text-align: center !important;
                }
                .print-header h1 {
                  font-size: 16pt !important;
                  font-weight: bold !important;
                  margin: 0 0 4px 0 !important;
                  text-decoration: underline !important;
                }
                .print-header h2 {
                  font-size: 12pt !important;
                  font-weight: bold !important;
                  margin: 0 0 2px 0 !important;
                }
                .print-header p {
                  font-size: 9pt !important;
                  margin: 0 !important;
                  color: #333 !important;
                }
                .print-meta {
                  display: flex !important;
                  justify-content: space-between !important;
                  font-size: 8pt !important;
                  color: #666 !important;
                  margin-top: 8px !important;
                  padding-top: 4px !important;
                  border-top: 1px solid #ccc !important;
                }
                .print-inventory-table {
                  width: 100% !important;
                  border-collapse: collapse !important;
                  font-size: 9pt !important;
                  line-height: 1.15 !important;
                  margin-top: 8px !important;
                }
                .print-inventory-table thead {
                  display: table-header-group !important;
                }
                .print-inventory-table th {
                  font-size: 10pt !important;
                  font-weight: bold !important;
                  padding: 4px 8px !important;
                  border-bottom: 2px solid #333 !important;
                  text-align: left !important;
                  background-color: #f8f8f8 !important;
                }
                .print-inventory-table th.qty-col {
                  text-align: right !important;
                  width: 100px !important;
                }
                .print-inventory-table tbody tr {
                  break-inside: avoid !important;
                  page-break-inside: avoid !important;
                }
                .print-inventory-table td {
                  padding: 3px 8px !important;
                  border-bottom: 1px solid #999 !important;
                  vertical-align: middle !important;
                }
                .print-inventory-table td.qty-col {
                  text-align: right !important;
                  font-weight: 500 !important;
                  white-space: nowrap !important;
                }
                .print-inventory-table tr.group-row {
                  break-inside: avoid !important;
                  page-break-inside: avoid !important;
                }
                .print-inventory-table tr.group-row td {
                  font-weight: bold !important;
                  font-size: 10pt !important;
                  background-color: #eaeaea !important;
                  padding: 4px 8px !important;
                  border-bottom: 1px solid #666 !important;
                  border-top: 1px solid #666 !important;
                }
                .print-inventory-table tr.item-row td {
                  padding-left: 16px !important;
                  font-size: 9pt !important;
                }
                .print-inventory-table tr.item-row td.qty-col {
                  padding-right: 8px !important;
                }
                .print-inventory-table tr.total-row {
                  break-inside: avoid !important;
                }
                .print-inventory-table tr.total-row td {
                  font-weight: bold !important;
                  font-size: 10pt !important;
                  border-top: 2px solid #333 !important;
                  border-bottom: 2px solid #333 !important;
                  padding: 5px 8px !important;
                  background-color: #f0f0f0 !important;
                }
                .print-inventory-table tr.negative-row td {
                  background-color: rgba(255, 200, 200, 0.5) !important;
                }
                .print-inventory-table .negative-value {
                  font-weight: 600 !important;
                }
                .print-inventory-table .qty-unit {
                  margin-left: 0.5em !important;
                }
                .screen-only {
                  display: none !important;
                }
              }
              @media screen {
                .print-header {
                  display: none !important;
                }
                .print-inventory-table {
                  display: none !important;
                }
              }
            `}</style>
            {/* Print header */}
            <div className="print-header mb-6">
              <h1>{selectedLocationLocal.name}</h1>
              <h2>Godown Summary</h2>
              <p>{format(asOfDate ? new Date(asOfDate) : new Date(), "dd-MMM-yy")}</p>
              <div className="print-meta">
                <span>Printed: {format(new Date(), "dd-MMM-yy HH:mm")}</span>
                <span>Page 1</span>
              </div>
            </div>

            {inventoryLoading ? (
              <div className="p-6 text-center">
                <Skeleton className="h-8 w-full" />
              </div>
            ) : inventory.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  No inventory found at this location.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6 w-full">
                {(() => {
                  // Group items by stock group, applying search filter
                  const searchLower = itemSearchTerm.toLowerCase();
                  const sortedInventory = [...inventory]
                    .filter((item) => {
                      if (!searchLower) return true;
                      return (
                        (item.stockItemName ?? "").toLowerCase().includes(searchLower) ||
                        (item.stockItemCode ?? "").toLowerCase().includes(searchLower)
                      );
                    })
                    .sort((a, b) => {
                      const groupCompare = (a.stockGroupName || "").localeCompare(b.stockGroupName || "");
                      if (groupCompare !== 0) return groupCompare;
                      return a.stockItemName.localeCompare(b.stockItemName);
                    });

                  const groupedInventory = sortedInventory.reduce((acc, item) => {
                    const groupKey = item.stockGroupCode || "UNCAT";
                    const groupName = item.stockGroupName || "Unassigned";
                    if (!acc[groupKey]) {
                      acc[groupKey] = { name: groupName, items: [] };
                    }
                    acc[groupKey].items.push(item);
                    return acc;
                  }, {} as Record<string, { name: string; items: typeof inventory }>);

                  return (
                    <>
                      {/* Screen view - Mobile cards */}
                      <div className="screen-only md:hidden space-y-4">
                        {Object.entries(groupedInventory).map(([groupCode, { name, items }]) => (
                          <div key={`mobile-group-${groupCode}`}>
                            <div className="font-bold text-sm bg-muted/30 px-3 py-2 rounded-md mb-2">{name}</div>
                            <div className="space-y-2">
                              {items.map((item) => {
                                const itemQty = parseFloat(item.quantity || "0");
                                const isNegative = itemQty < 0;
                                return (
                                  <Card
                                    key={item.inventoryId}
                                    className={`p-3 ${isNegative ? "bg-red-100 dark:bg-red-900/30" : "hover-elevate"}`}
                                  >
                                    <button
                                      onClick={() => navigate(`/locations/${item.locationId}/stock-items/${item.stockItemId}/history`)}
                                      className="text-left text-primary hover:underline cursor-pointer font-medium mb-2 block"
                                      data-testid={`link-all-item-${item.stockItemId}`}
                                    >
                                      <span className="flex items-center gap-2 flex-wrap">
                                        {item.stockItemName}
                                        {item.stockItemActive === false && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                                      </span>
                                    </button>
                                    <div className="grid grid-cols-2 gap-2 text-sm">
                                      <div>
                                        <span className="text-muted-foreground">Qty: </span>
                                        <span className={`font-mono ${isNegative ? "text-red-600 font-semibold" : ""}`}>
                                          {Math.floor(itemQty).toLocaleString()} BL
                                        </span>
                                      </div>
                                      {!posUser && (
                                        <>
                                          <div className="text-right">
                                            <span className="text-muted-foreground">Rate: </span>
                                            <span className="font-mono">{formatAmount(parseFloat(item.averageRate))}</span>
                                          </div>
                                          <div className="col-span-2 text-right">
                                            <span className="text-muted-foreground">Value: </span>
                                            <span className="font-mono font-medium">{formatAmount(parseFloat(item.totalValue))}</span>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  </Card>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                        <Card className="p-3 bg-muted/50">
                          <div className="flex items-center justify-between font-bold text-sm">
                            <span>Grand Total</span>
                            <span className="font-mono">{Math.floor(inventory.reduce((sum, item) => sum + parseFloat(item.quantity || "0"), 0)).toLocaleString()} BL</span>
                          </div>
                          {!posUser && (
                            <div className="text-right text-sm font-mono font-bold mt-1">
                              {formatAmount(inventory.reduce((sum, item) => sum + parseFloat(item.totalValue || "0"), 0))}
                            </div>
                          )}
                        </Card>
                      </div>

                      {/* Screen view - Desktop table */}
                      <div className="screen-only hidden md:block w-full min-w-0">
                        <Card className="w-full overflow-hidden">
                          <div className="overflow-auto max-h-[calc(100vh-200px)] w-full min-w-0">
                            <table className="w-full min-w-full table-fixed text-sm">
                              <colgroup>
                                <col />
                                <col className="w-36" />
                                {!posUser && (
                                  <>
                                    <col className="w-32" />
                                    <col className="w-40" />
                                  </>
                                )}
                              </colgroup>
                              <thead className="bg-muted/50 sticky top-0 z-30">
                                <tr className="h-10">
                                  <th className="text-left px-3 font-medium">Name</th>
                                  <th className={`text-right px-3 font-medium ${posUser ? "pr-6" : ""}`}>Quantity</th>
                                  {!posUser && (
                                    <>
                                      <th className="text-right px-3 font-medium">Avg Rate</th>
                                      <th className="text-right px-3 pr-6 font-medium">Total Value</th>
                                    </>
                                  )}
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(groupedInventory).map(([groupCode, { name, items }]) => (
                                  <>
                                    <tr key={`header-${groupCode}`} className="bg-muted/40 border-t">
                                      <td className="px-3 py-2">
                                        <div className="flex items-center gap-2">
                                          <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                                            <Layers className="h-3 w-3 text-primary" />
                                          </div>
                                          <span className="font-semibold text-sm">{name}</span>
                                          <Badge variant="secondary" className="font-mono text-xs ml-1">
                                            {items.length}
                                          </Badge>
                                        </div>
                                      </td>
                                      <td className="px-3 py-2 text-right font-mono text-sm text-muted-foreground font-medium">
                                        {Math.floor(items.reduce((s, i) => s + parseFloat(i.quantity || "0"), 0)).toLocaleString()} <span className="text-xs">BL</span>
                                      </td>
                                      {!posUser && (
                                        <>
                                          <td />
                                          <td className="px-3 py-2 text-right font-mono text-sm text-muted-foreground font-medium">
                                            {formatAmount(items.reduce((s, i) => s + parseFloat(i.totalValue || "0"), 0))}
                                          </td>
                                        </>
                                      )}
                                    </tr>
                                    {items.map((item) => {
                                      const itemQty = parseFloat(item.quantity || "0");
                                      const isNegative = itemQty < 0;
                                      return (
                                        <tr key={item.inventoryId} className={`border-t ${isNegative ? "bg-rose-50 dark:bg-rose-950/30" : "hover-elevate"}`}>
                                          <td className="px-3 py-2.5 pl-6">
                                            <button
                                              onClick={() => navigate(`/locations/${item.locationId}/stock-items/${item.stockItemId}/history`)}
                                              className="text-left text-primary hover:underline cursor-pointer"
                                              data-testid={`link-all-item-desktop-${item.stockItemId}`}
                                            >
                                              <span className="flex items-center gap-2 flex-wrap">
                                                {item.stockItemName}
                                                {item.stockItemActive === false && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                                              </span>
                                            </button>
                                          </td>
                                          <td className={`px-3 text-right font-mono font-semibold ${isNegative ? "text-red-600" : ""}`}>
                                            {Math.floor(itemQty).toLocaleString()}<span className="ml-2 text-xs font-normal text-muted-foreground">BL</span>
                                          </td>
                                          {!posUser && (
                                            <>
                                              <td className="px-3 text-right font-mono text-sm text-muted-foreground">
                                                {formatAmount(parseFloat(item.averageRate))}
                                              </td>
                                              <td className="px-3 text-right font-mono font-semibold">
                                                {formatAmount(parseFloat(item.totalValue))}
                                              </td>
                                            </>
                                          )}
                                        </tr>
                                      );
                                    })}
                                  </>
                                ))}
                                <tr className="bg-muted/50 border-t-2 font-semibold h-12">
                                  <td className="px-3 font-bold">Grand Total</td>
                                  <td className="px-3 text-right font-mono font-bold">
                                    {Math.floor(inventory.reduce((sum, item) => sum + parseFloat(item.quantity || "0"), 0)).toLocaleString()}
                                  </td>
                                  {!posUser && (
                                    <>
                                      <td className="px-3"></td>
                                      <td className="px-3 text-right font-mono font-bold">
                                        {formatAmount(inventory.reduce((sum, item) => sum + parseFloat(item.totalValue || "0"), 0))}
                                      </td>
                                    </>
                                  )}
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </Card>
                      </div>

                      {/* Print view - Proper table layout */}
                      <table className="print-inventory-table">
                        <thead className="sticky top-0 z-30 bg-muted/50">
                          <tr>
                            <th>Particulars</th>
                            <th className="qty-col">Closing Balance<br/><span style={{ fontWeight: 'normal', fontSize: '8pt' }}>Quantity</span></th>
                            {printWithCost && <th className="qty-col">Avg Rate</th>}
                            {printWithCost && <th className="qty-col">Total Value</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(groupedInventory).map(([groupCode, { name, items }]) => {
                            const groupTotal = items.reduce((sum, item) => sum + parseFloat(item.quantity || "0"), 0);
                            const groupValue = items.reduce((sum, item) => sum + parseFloat(item.totalValue || "0"), 0);
                            const firstItemUom = items[0]?.stockItemUom || "";
                            const isGroupNegative = groupTotal < 0;
                            
                            return (
                              <>
                                {/* Group header row */}
                                <tr key={`group-${groupCode}`} className={`group-row ${isGroupNegative ? "negative-row" : ""}`}>
                                  <td>{name}</td>
                                  <td className="qty-col">
                                    <span className={isGroupNegative ? "negative-value" : ""}>{Math.floor(groupTotal).toLocaleString()}</span>
                                    <span className="qty-unit">{firstItemUom}</span>
                                  </td>
                                  {printWithCost && <td className="qty-col"></td>}
                                  {printWithCost && <td className="qty-col">{formatAmount(groupValue)}</td>}
                                </tr>
                                {/* Group items */}
                                {items.map((item) => {
                                  const itemQty = parseFloat(item.quantity || "0");
                                  const isItemNegative = itemQty < 0;
                                  return (
                                    <tr key={`item-${item.inventoryId}`} className={`item-row ${isItemNegative ? "negative-row" : ""}`}>
                                      <td>{item.stockItemName}{item.stockItemActive === false ? " (Inactive)" : ""}</td>
                                      <td className="qty-col">
                                        <span className={isItemNegative ? "negative-value" : ""}>{Math.floor(itemQty).toLocaleString()}</span>
                                        <span className="qty-unit">{item.stockItemUom}</span>
                                      </td>
                                      {printWithCost && <td className="qty-col">{formatAmount(parseFloat(item.averageRate))}</td>}
                                      {printWithCost && <td className="qty-col">{formatAmount(parseFloat(item.totalValue))}</td>}
                                    </tr>
                                  );
                                })}
                              </>
                            );
                          })}
                          {/* Grand Total row */}
                          <tr className="total-row">
                            <td>Grand Total</td>
                            <td className="qty-col">
                              <span>{Math.floor(inventory.reduce((sum, item) => sum + parseFloat(item.quantity || "0"), 0)).toLocaleString()}</span>
                              <span className="qty-unit">{inventory[0]?.stockItemUom || ""}</span>
                            </td>
                            {printWithCost && <td className="qty-col"></td>}
                            {printWithCost && <td className="qty-col">{formatAmount(inventory.reduce((sum, item) => sum + parseFloat(item.totalValue || "0"), 0))}</td>}
                          </tr>
                        </tbody>
                      </table>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}
      </>
      )}

      {/* Archive Stock Group Confirmation Dialog - placed at root level */}
      <AlertDialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Stock Group</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to archive "{selectedGroup?.groupName}" from "{selectedLocationLocal?.name}"? 
              This will clear all inventory for this stock group at this location. 
              A backup will be saved and you can restore it from Orphaned Records if needed.
              Your POS sales history and monthly reports will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-archive">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleArchiveStockGroup}
              disabled={isArchiving}
              data-testid="button-confirm-archive"
            >
              {isArchiving ? "Archiving..." : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* WhatsApp Group Dialog */}
      <Dialog open={waGroupDialogOpen} onOpenChange={(open) => { if (!open) setWaGroupDialogOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set WhatsApp Group</DialogTitle>
            <DialogDescription>
              Choose the WhatsApp group that <strong>{waGroupLocation?.name}</strong> will send stock reports to. Leave unset to keep the feature off for this location.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                className="flex h-9 w-full rounded-md border border-input bg-transparent pl-8 pr-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Search groups…"
                value={waGroupSearch}
                onChange={(e) => setWaGroupSearch(e.target.value)}
                data-testid="input-wa-group-search"
              />
            </div>
            {waChatsLoading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Loading groups…</p>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-md border divide-y">
                <button
                  className={`w-full text-left px-3 py-2 text-sm hover-elevate ${!waGroupSelectedId ? "bg-muted font-medium" : ""}`}
                  onClick={() => setWaGroupSelectedId("")}
                  data-testid="button-wa-group-none"
                >
                  None (disable)
                </button>
                {waChats
                  .filter((c) => c.type === "group" && c.name.toLowerCase().includes(waGroupSearch.toLowerCase()))
                  .map((chat) => (
                    <button
                      key={chat.id}
                      className={`w-full text-left px-3 py-2 text-sm hover-elevate flex items-center gap-2 ${waGroupSelectedId === chat.id ? "bg-muted font-medium" : ""}`}
                      onClick={() => setWaGroupSelectedId(chat.id)}
                      data-testid={`button-wa-group-${chat.id}`}
                    >
                      <MessageCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate">{chat.name}</span>
                      {waGroupSelectedId === chat.id && <Check className="h-4 w-4 ml-auto shrink-0 text-green-600 dark:text-green-400" />}
                    </button>
                  ))}
                {!waChatsLoading && waChats.filter((c) => c.type === "group").length === 0 && (
                  <p className="text-sm text-muted-foreground px-3 py-4 text-center">No groups found. Make sure WhatsApp is configured.</p>
                )}
              </div>
            )}
            {waGroupSelectedId && (
              <p className="text-xs text-muted-foreground">
                Selected: <code className="font-mono">{waGroupSelectedId}</code>
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaGroupDialogOpen(false)} data-testid="button-wa-group-cancel">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (waGroupLocation) {
                  waGroupMutation.mutate({
                    id: waGroupLocation.id,
                    name: waGroupLocation.name,
                    whatsappGroupChatId: waGroupSelectedId || null,
                  });
                }
              }}
              disabled={waGroupMutation.isPending}
              data-testid="button-wa-group-save"
            >
              {waGroupMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Location Dialog */}
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
