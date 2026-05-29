import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, MapPin, Tag, AlertCircle, Check, X, Pencil, Layers, EyeOff, Eye, Download, Upload, FileSpreadsheet } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";

const ALL_LOCATIONS_ID = -1;

interface Location {
  id: number;
  code: string;
  name: string;
  active?: boolean;
}

interface PriceListItem {
  stockItemId: number;
  code: string;
  name: string;
  stockGroupName: string;
  baseSellingPrice: string | null;
  hasCustomPrice: boolean;
  sellingPrice: string | null;
  quantity: string;
  costPrice?: string | null;
  offloadingCost?: string | null;
}

interface MasterItem {
  stockItemId: number;
  code: string;
  name: string;
  stockGroupName: string;
  baseSellingPrice: string | null;
  masterPrices: Record<number, string>;
  costPrice?: string | null;
  offloadingCost?: string | null;
}

interface MasterPriceListResponse {
  masters: { id: number; name: string }[];
  items: MasterItem[];
}

interface POSPriceListProps {
  posUser?: any;
}

function formatQty(raw: string | number | null | undefined): string {
  if (raw == null) return "—";
  const n = typeof raw === "string" ? parseFloat(raw) : raw;
  if (isNaN(n) || n === 0) return "—";
  return n % 1 === 0 ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export default function POSPriceList({ posUser }: POSPriceListProps) {
  const { formatAmount } = useCurrencyContext();
  const { toast } = useToast();
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [editingItem, setEditingItem] = useState<{ stockItemId: number; locationId: number; value: string } | null>(null);
  const [showUnpriced, setShowUnpriced] = useState(false);
  const [hiddenUnpricedGroups, setHiddenUnpricedGroups] = useState<Set<string>>(new Set());
  const [hiddenLocations, setHiddenLocations] = useState<Set<number>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const editingItemRef = useRef(editingItem);
  useEffect(() => { editingItemRef.current = editingItem; }, [editingItem]);
  const lastSavedRef = useRef<{ stockItemId: number; locationId: number } | null>(null);
  const skipBlurSaveRef = useRef(false);

  const { data: currentUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isPrivileged = ["Admin", "Owner", "Manager", "Developer"].includes(currentUser?.role || "");

  const { data: posAssignedLocations = [], isLoading: posLocationsLoading } = useQuery<Location[]>({
    queryKey: ["/api/my-locations"],
    enabled: !!posUser,
  });

  const { data: allLocations = [], isLoading: allLocationsLoading } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
    enabled: !posUser,
  });

  const locations = posUser ? posAssignedLocations : allLocations;
  const locationsLoading = posUser ? posLocationsLoading : allLocationsLoading;

  useEffect(() => {
    if (locations.length === 1 && selectedLocationId === null) {
      setSelectedLocationId(locations[0].id);
    }
  }, [locations, selectedLocationId]);

  const isAllMode = selectedLocationId === ALL_LOCATIONS_ID;

  // ── Single-location price list ──────────────────────────────────────────────
  const {
    data: priceList = [],
    isLoading: priceListLoading,
    isError: priceListError,
    error: priceListErrorObj,
  } = useQuery<PriceListItem[]>({
    queryKey: ["/api/pos/price-list", selectedLocationId],
    queryFn: async () => {
      const res = await fetch(`/api/pos/price-list?locationId=${selectedLocationId}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(body.message || "Failed to load price list");
      }
      return res.json();
    },
    enabled: !!selectedLocationId && !isAllMode,
  });

  // ── All-masters price list ──────────────────────────────────────────────────
  const {
    data: mastersData,
    isLoading: mastersLoading,
    isError: mastersError,
    error: mastersErrorObj,
  } = useQuery<MasterPriceListResponse>({
    queryKey: ["/api/pos/price-list-by-masters"],
    queryFn: async () => {
      const res = await fetch("/api/pos/price-list-by-masters", { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(body.message || "Failed to load price list");
      }
      return res.json();
    },
    enabled: isAllMode,
  });

  const masters = mastersData?.masters ?? [];
  const masterItems = mastersData?.items ?? [];

  // ── Merged state ────────────────────────────────────────────────────────────
  const isLoading = isAllMode ? mastersLoading : priceListLoading;
  const isError = isAllMode ? mastersError : priceListError;
  const error = isAllMode ? mastersErrorObj : priceListErrorObj;

  const visibleMasters = useMemo(() => {
    if (!isAllMode) return masters;
    return masters.filter((m) => !hiddenLocations.has(m.id));
  }, [isAllMode, masters, hiddenLocations]);

  const locationPricedList = useMemo(() => {
    if (isAllMode) return masterItems as any[];
    if (!posUser) return priceList;
    return priceList.filter((item) => item.hasCustomPrice && item.sellingPrice !== null);
  }, [priceList, masterItems, posUser, isAllMode]);

  const stockGroups = useMemo(() => {
    const groups = new Set<string>();
    locationPricedList.forEach((item) => {
      if (item.stockGroupName) groups.add(item.stockGroupName);
    });
    return Array.from(groups).sort();
  }, [locationPricedList]);

  const isItemUnpriced = (item: any): boolean => {
    if (isAllMode) {
      const hasBase = item.baseSellingPrice && parseFloat(item.baseSellingPrice) > 0;
      if (hasBase) return false; // base price covers all locations
      const allMasterPrices = item.masterPrices ? Object.values(item.masterPrices) : [];
      if (allMasterPrices.length === 0) return true;
      const allHavePrice = allMasterPrices.every((p: any) => p && parseFloat(p) > 0);
      return !allHavePrice; // unpriced until every location has a price
    }
    return !item.sellingPrice || parseFloat(item.sellingPrice) === 0;
  };

  const unpricedCount = useMemo(() => locationPricedList.filter(isItemUnpriced).length, [locationPricedList, isAllMode]);

  // Groups that have at least one unpriced item, with their counts — used for the chip picker
  const unpricedByGroup = useMemo<{ name: string; count: number }[]>(() => {
    if (!showUnpriced) return [];
    const map = new Map<string, number>();
    for (const item of locationPricedList) {
      if (!isItemUnpriced(item)) continue;
      const g = item.stockGroupName || "(No Group)";
      map.set(g, (map.get(g) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [locationPricedList, showUnpriced, isAllMode]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return locationPricedList.filter((item: any) => {
      const matchesSearch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        (item.code && item.code.toLowerCase().includes(q)) ||
        (item.stockGroupName && item.stockGroupName.toLowerCase().includes(q));
      const matchesGroup = showUnpriced
        ? !hiddenUnpricedGroups.has(item.stockGroupName || "(No Group)")
        : groupFilter === "all" || item.stockGroupName === groupFilter;
      const matchesUnpriced = !showUnpriced || isItemUnpriced(item);
      return matchesSearch && matchesGroup && matchesUnpriced;
    });
  }, [locationPricedList, search, groupFilter, showUnpriced, hiddenUnpricedGroups, isAllMode]);

  const selectedLocation = locations.find((l) => l.id === selectedLocationId);

  const updatePriceMutation = useMutation({
    mutationFn: async ({ stockItemId, locationId, sellingPrice }: { stockItemId: number; locationId: number; sellingPrice: string }) => {
      const res = await apiRequest("POST", `/api/stock-items/${stockItemId}/location-prices`, {
        locationId,
        sellingPrice,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Failed to update price" }));
        throw new Error(body.message || "Failed to update price");
      }
      return res.json();
    },
    onSuccess: () => {
      if (isAllMode) {
        queryClient.invalidateQueries({ queryKey: ["/api/pos/price-list-by-masters"] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/pos/price-list", selectedLocationId] });
      }
      toast({ title: "Price updated" });
      const current = editingItemRef.current;
      const lastSaved = lastSavedRef.current;
      if (current && lastSaved && current.stockItemId === lastSaved.stockItemId && current.locationId === lastSaved.locationId) {
        setEditingItem(null);
      }
      lastSavedRef.current = null;
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const startEdit = (stockItemId: number, locationId: number, currentPrice: string | null) => {
    if (posUser) return;
    lastSavedRef.current = null; // prevent onSuccess from clearing a re-opened edit
    const hasValue = currentPrice && parseFloat(currentPrice) > 0;
    setEditingItem({ stockItemId, locationId, value: hasValue ? currentPrice : "" });
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
  };

  const navigateEdit = (direction: "up" | "down") => {
    const current = editingItemRef.current;
    if (!current) return;
    const items = filteredItems;
    const idx = items.findIndex((i: any) => i.stockItemId === current.stockItemId);
    if (idx === -1) return;
    const nextIdx = direction === "up" ? idx - 1 : idx + 1;
    if (nextIdx < 0 || nextIdx >= items.length) return;
    const nextItem = items[nextIdx];
    const nextPrice = isAllMode
      ? (nextItem.masterPrices?.[current.locationId] ?? nextItem.baseSellingPrice ?? null)
      : nextItem.sellingPrice;
    const hasValue = nextPrice && parseFloat(nextPrice) > 0;
    setEditingItem({ stockItemId: nextItem.stockItemId, locationId: current.locationId, value: hasValue ? nextPrice : "" });
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
  };

  const navigateHorizontal = (direction: "left" | "right") => {
    const current = editingItemRef.current;
    if (!current) return;
    if (!isAllMode) {
      // Single-location mode: left/right behaves like up/down
      navigateEdit(direction === "left" ? "up" : "down");
      return;
    }
    const items = filteredItems;
    const idx = items.findIndex((i: any) => i.stockItemId === current.stockItemId);
    if (idx === -1) return;
    const masterIdx = visibleMasters.findIndex((m) => m.id === current.locationId);
    if (masterIdx === -1) return;
    if (direction === "left") {
      if (masterIdx > 0) {
        const prevMaster = visibleMasters[masterIdx - 1];
        const price = items[idx].masterPrices?.[prevMaster.id] ?? items[idx].baseSellingPrice ?? null;
        const hasValue = price && parseFloat(price) > 0;
        setEditingItem({ stockItemId: current.stockItemId, locationId: prevMaster.id, value: hasValue ? price : "" });
      } else if (idx > 0) {
        const prevItem = items[idx - 1];
        const lastMaster = visibleMasters[visibleMasters.length - 1];
        const price = prevItem.masterPrices?.[lastMaster.id] ?? prevItem.baseSellingPrice ?? null;
        const hasValue = price && parseFloat(price) > 0;
        setEditingItem({ stockItemId: prevItem.stockItemId, locationId: lastMaster.id, value: hasValue ? price : "" });
      } else {
        return;
      }
    } else {
      // direction === "right"
      if (masterIdx < visibleMasters.length - 1) {
        const nextMaster = visibleMasters[masterIdx + 1];
        const price = items[idx].masterPrices?.[nextMaster.id] ?? items[idx].baseSellingPrice ?? null;
        const hasValue = price && parseFloat(price) > 0;
        setEditingItem({ stockItemId: current.stockItemId, locationId: nextMaster.id, value: hasValue ? price : "" });
      } else if (idx < items.length - 1) {
        const nextItem = items[idx + 1];
        const firstMaster = visibleMasters[0];
        const price = nextItem.masterPrices?.[firstMaster.id] ?? nextItem.baseSellingPrice ?? null;
        const hasValue = price && parseFloat(price) > 0;
        setEditingItem({ stockItemId: nextItem.stockItemId, locationId: firstMaster.id, value: hasValue ? price : "" });
      } else {
        return;
      }
    }
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
  };

  const commitEdit = () => {
    if (!editingItem) return;
    const val = editingItem.value.trim();
    if (!val || isNaN(parseFloat(val))) {
      toast({ title: "Invalid price", description: "Enter a valid number.", variant: "destructive" });
      return;
    }
    lastSavedRef.current = { stockItemId: editingItem.stockItemId, locationId: editingItem.locationId };
    updatePriceMutation.mutate({
      stockItemId: editingItem.stockItemId,
      locationId: editingItem.locationId,
      sellingPrice: val,
    });
  };

  const cancelEdit = () => setEditingItem(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); commitEdit(); return; }
    if (e.key === "Escape") { e.preventDefault(); cancelEdit(); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); skipBlurSaveRef.current = true; commitEdit(); navigateEdit("up"); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); skipBlurSaveRef.current = true; commitEdit(); navigateEdit("down"); return; }
    if (e.key === "ArrowLeft") { e.preventDefault(); skipBlurSaveRef.current = true; commitEdit(); navigateHorizontal("left"); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); skipBlurSaveRef.current = true; commitEdit(); navigateHorizontal("right"); return; }
  };

  const handleBlur = () => {
    if (skipBlurSaveRef.current) {
      skipBlurSaveRef.current = false;
      return;
    }
    const current = editingItemRef.current;
    if (!current) return;
    const val = current.value.trim();
    if (!val || isNaN(parseFloat(val))) {
      cancelEdit();
      return;
    }
    lastSavedRef.current = { stockItemId: current.stockItemId, locationId: current.locationId };
    updatePriceMutation.mutate({
      stockItemId: current.stockItemId,
      locationId: current.locationId,
      sellingPrice: val,
    });
  };

  const canEdit = !posUser;
  const showCostPrice = isPrivileged && !posUser;

  const [exporting, setExporting] = useState(false);

  // ── Import state ─────────────────────────────────────────────────────────────
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<{ barcode: string; name: string; changes: { locationId: number; locationName: string; price: string }[] }[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = async () => {
    if (!isAllMode || masters.length === 0) return;
    const XLSX = await import("@/lib/excelHelper");
    const rows = masterItems.map((item: MasterItem) => {
      const row: Record<string, any> = {
        Code: item.code || "",
        "Item Name": item.name,
        Group: item.stockGroupName || "",
      };
      for (const m of masters) {
        const price = item.masterPrices?.[m.id] ?? item.baseSellingPrice ?? null;
        row[m.name] = price && parseFloat(price) > 0 ? parseFloat(price) : "";
      }
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Price List");
    const dateStr = new Date().toLocaleDateString("en-CA");
    await XLSX.writeFile(wb, `price_list_template_${dateStr}.xlsx`);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImportError(null);
    try {
      const XLSX = await import("@/lib/excelHelper");
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (rawRows.length === 0) { setImportError("The file has no data rows."); return; }

      // Build locationName → locationId map from current masters
      const nameToId = new Map<string, number>();
      for (const m of masters) nameToId.set(m.name.toLowerCase().trim(), m.id);
      const locationCols = Object.keys(rawRows[0]).filter((col) => nameToId.has(col.toLowerCase().trim()));
      if (locationCols.length === 0) { setImportError("No location columns found. Download the template first."); return; }

      const preview: typeof importPreview = [];
      for (const row of rawRows) {
        const barcode = String(row["Code"] || "").trim();
        const name = String(row["Item Name"] || "").trim();
        if (!barcode) continue;
        const changes: { locationId: number; locationName: string; price: string }[] = [];
        for (const col of locationCols) {
          const raw = row[col];
          const parsed = parseFloat(String(raw));
          if (!isNaN(parsed) && parsed > 0) {
            changes.push({ locationId: nameToId.get(col.toLowerCase().trim())!, locationName: col, price: parsed.toFixed(2) });
          }
        }
        if (changes.length > 0) preview.push({ barcode, name, changes });
      }
      if (preview.length === 0) { setImportError("No valid price entries found in the file."); return; }
      setImportPreview(preview);
      setImportDialogOpen(true);
    } catch {
      setImportError("Could not read the file. Make sure it is a valid .xlsx file.");
    }
  };

  const handleImportSubmit = async () => {
    if (importPreview.length === 0) return;
    setImporting(true);
    try {
      const prices: { barcode: string; sellingPrice: string; locationId: number }[] = [];
      for (const item of importPreview) {
        for (const c of item.changes) {
          prices.push({ barcode: item.barcode, sellingPrice: c.price, locationId: c.locationId });
        }
      }
      const res = await apiRequest("POST", "/api/stock-items/bulk-update-prices", { prices });
      const data = await res.json();
      toast({ title: "Price list uploaded", description: data.message || `Updated ${importPreview.length} items.` });
      setImportDialogOpen(false);
      setImportPreview([]);
      queryClient.invalidateQueries({ queryKey: ["/api/pos/price-list-by-masters"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/price-list", selectedLocationId] });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message || "Something went wrong.", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const exportToExcel = async () => {
    if (filteredItems.length === 0) return;
    setExporting(true);
    try {
      const XLSX = await import("@/lib/excelHelper");

      const rows = filteredItems.map((item: any) => {
        const row: Record<string, any> = {
          Code: item.code || "",
          "Item Name": item.name,
          Group: item.stockGroupName || "",
        };

        if (showCostPrice) {
          row["Cost Price"] = item.costPrice && parseFloat(item.costPrice) > 0
            ? parseFloat(item.costPrice)
            : "";
          const offloadTotal = parseFloat(item.costPrice ?? "0") + parseFloat(item.offloadingCost ?? "0");
          row["Cost + Offloading"] = offloadTotal > 0 ? offloadTotal : "";
        }

        if (isAllMode) {
          for (const m of masters) {
            const price = item.masterPrices?.[m.id] ?? item.baseSellingPrice ?? null;
            row[m.name] = price && parseFloat(price) > 0 ? parseFloat(price) : "";
          }
        } else {
          row["Selling Price"] = item.sellingPrice && parseFloat(item.sellingPrice) > 0
            ? parseFloat(item.sellingPrice)
            : item.baseSellingPrice && parseFloat(item.baseSellingPrice) > 0
              ? parseFloat(item.baseSellingPrice)
              : "";
          row["Qty in Stock"] = item.quantity && parseFloat(item.quantity) > 0
            ? parseFloat(item.quantity)
            : "";
        }

        return row;
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Price List");

      const locationLabel = isAllMode
        ? "All_Locations"
        : selectedLocation?.name.replace(/\s+/g, "_") ?? "Unknown";
      const dateStr = new Date().toLocaleDateString("en-CA");
      const filterPart = showUnpriced ? "_unpriced" : groupFilter !== "all" ? `_${groupFilter.replace(/\s+/g, "_")}` : "";
      const searchPart = search.trim() ? `_search-${search.trim().replace(/\s+/g, "_")}` : "";

      await XLSX.writeFile(wb, `price_list_${locationLabel}${filterPart}${searchPart}_${dateStr}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Locations sidebar ── */}
      <div className="w-52 shrink-0 border-r flex flex-col overflow-hidden bg-sidebar">
        <div className="flex items-center gap-2 px-3 py-3 border-b">
          <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold text-sidebar-foreground">Locations</span>
          {!locationsLoading && locations.length > 0 && (
            <Badge variant="secondary" className="ml-auto text-xs px-1.5 py-0">
              {locations.length}
            </Badge>
          )}
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {locationsLoading ? (
            <div className="flex flex-col gap-1 px-2 py-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full rounded-md" />)}
            </div>
          ) : locations.length === 0 ? (
            <p className="text-xs text-muted-foreground px-3 py-4">No locations.</p>
          ) : (
            <div className="flex flex-col gap-0.5 px-2 py-1">
              {!posUser && (
                <button
                  data-testid="button-location-all"
                  onClick={() => { setSelectedLocationId(ALL_LOCATIONS_ID); setSearch(""); setGroupFilter("all"); setEditingItem(null); setShowUnpriced(false); setHiddenUnpricedGroups(new Set()); }}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-md text-sm transition-colors hover-elevate flex items-center gap-1.5",
                    selectedLocationId === ALL_LOCATIONS_ID
                      ? "bg-primary text-primary-foreground font-medium"
                      : "text-sidebar-foreground"
                  )}
                >
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  All Locations
                </button>
              )}
              {locations.map((loc) => (
                <button
                  key={loc.id}
                  data-testid={`button-location-${loc.id}`}
                  onClick={() => { setSelectedLocationId(loc.id); setSearch(""); setGroupFilter("all"); setEditingItem(null); setShowUnpriced(false); setHiddenUnpricedGroups(new Set()); }}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-md text-sm transition-colors hover-elevate flex items-center gap-2",
                    selectedLocationId === loc.id
                      ? "bg-primary text-primary-foreground font-medium"
                      : "bg-sidebar-accent/30 text-sidebar-foreground hover:bg-sidebar-accent/50"
                  )}
                >
                  <MapPin className="w-3.5 h-3.5 shrink-0 opacity-60" />
                  {loc.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0 flex-wrap">
          <Tag className="w-4 h-4 text-muted-foreground" />
          <PageHeader title="Price List" showBackButton={false} />
          {isAllMode ? (
            <Badge variant="secondary" className="gap-1">
              <Layers className="w-3 h-3" />
              All Locations
            </Badge>
          ) : selectedLocation ? (
            <Badge variant="secondary" className="gap-1">
              <MapPin className="w-3 h-3" />
              {selectedLocation.name}
            </Badge>
          ) : null}
          {selectedLocationId && (
            <div className="ml-auto flex items-center gap-2">
              {isAllMode && canEdit && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="button-download-price-template"
                    onClick={downloadTemplate}
                    disabled={masters.length === 0}
                    className="gap-1.5"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    Template
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="button-upload-price-list"
                    onClick={() => { setImportError(null); importFileRef.current?.click(); }}
                    className="gap-1.5"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Upload
                  </Button>
                  <input
                    ref={importFileRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={handleImportFile}
                    data-testid="input-import-price-file"
                  />
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                data-testid="button-export-price-list"
                onClick={exportToExcel}
                disabled={exporting || filteredItems.length === 0}
                className="gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                {exporting ? "Exporting…" : "Export"}
              </Button>
            </div>
          )}
        </div>

        {isAllMode && selectedLocationId && (
          <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b shrink-0 bg-muted/30">
            <span className="text-xs text-muted-foreground shrink-0 mr-1">Locations:</span>
            {masters.map((m) => {
              const isHidden = hiddenLocations.has(m.id);
              return (
                <button
                  key={m.id}
                  data-testid={`chip-location-${m.id}`}
                  onClick={() => {
                    setHiddenLocations((prev) => {
                      const next = new Set(prev);
                      if (next.has(m.id)) next.delete(m.id);
                      else next.add(m.id);
                      return next;
                    });
                  }}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-all",
                    isHidden
                      ? "bg-muted text-muted-foreground border-border line-through opacity-50"
                      : "bg-background text-foreground border-border hover-elevate"
                  )}
                >
                  {m.name}
                </button>
              );
            })}
            <div className="flex gap-1 ml-auto">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => setHiddenLocations(new Set())}
                data-testid="button-show-all-locations"
              >
                <Eye className="w-3 h-3 mr-1" />Show All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => setHiddenLocations(new Set(masters.map((m) => m.id)))}
                data-testid="button-hide-all-locations"
              >
                <EyeOff className="w-3 h-3 mr-1" />Hide All
              </Button>
            </div>
          </div>
        )}

        {selectedLocationId && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b shrink-0">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                data-testid="input-price-search"
                className="pl-8"
                placeholder="Search by name or code…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {stockGroups.length > 0 && !showUnpriced && (
              <Select value={groupFilter} onValueChange={setGroupFilter}>
                <SelectTrigger data-testid="select-group-filter" className="w-44">
                  <SelectValue placeholder="All groups" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All groups</SelectItem>
                  {stockGroups.map((g) => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {canEdit && (
              <Button
                variant={showUnpriced ? "default" : "outline"}
                size="sm"
                data-testid="button-show-unpriced"
                onClick={() => {
                  setShowUnpriced((v) => !v);
                  setHiddenUnpricedGroups(new Set());
                  setGroupFilter("all");
                }}
                className="gap-1.5 shrink-0"
              >
                <EyeOff className="w-3.5 h-3.5" />
                Unpriced
                {unpricedCount > 0 && (
                  <Badge variant={showUnpriced ? "secondary" : "destructive"} className="ml-0.5 px-1.5 py-0 text-xs">
                    {unpricedCount}
                  </Badge>
                )}
              </Button>
            )}
          </div>
        )}

        {/* ── Unpriced group chips ── */}
        {selectedLocationId && showUnpriced && unpricedByGroup.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b shrink-0 bg-muted/30">
            <span className="text-xs text-muted-foreground shrink-0 mr-1">Groups:</span>
            {unpricedByGroup.map(({ name, count }) => {
              const isHidden = hiddenUnpricedGroups.has(name);
              return (
                <button
                  key={name}
                  data-testid={`chip-unpriced-group-${name}`}
                  onClick={() => {
                    setHiddenUnpricedGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(name)) next.delete(name);
                      else next.add(name);
                      return next;
                    });
                  }}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-all",
                    isHidden
                      ? "bg-muted text-muted-foreground border-border line-through opacity-50"
                      : "bg-background text-foreground border-border hover-elevate"
                  )}
                >
                  {name}
                  <span className={cn(
                    "text-[10px] font-semibold px-1 py-0 rounded-full",
                    isHidden ? "bg-muted-foreground/20 text-muted-foreground" : "bg-amber-500/20 text-amber-700 dark:text-amber-400"
                  )}>
                    {count}
                  </span>
                </button>
              );
            })}
            <div className="flex gap-1 ml-auto">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => setHiddenUnpricedGroups(new Set())}
                data-testid="button-show-all-unpriced-groups"
              >
                <Eye className="w-3 h-3 mr-1" />Show All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => setHiddenUnpricedGroups(new Set(unpricedByGroup.map((g) => g.name)))}
                data-testid="button-hide-all-unpriced-groups"
              >
                <EyeOff className="w-3 h-3 mr-1" />Hide All
              </Button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-hidden p-4">
          {!selectedLocationId && !locationsLoading && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-muted-foreground">
              <MapPin className="w-12 h-12 opacity-25" />
              <div>
                <p className="text-base font-medium">Select a location</p>
                <p className="text-sm mt-1 opacity-70">Choose a location from the panel on the left to view and edit prices.</p>
              </div>
            </div>
          )}

          {isError && (
            <Alert variant="destructive">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>{(error as Error)?.message || "Failed to load price list."}</AlertDescription>
            </Alert>
          )}

          {selectedLocationId && isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          )}

          {selectedLocationId && !isLoading && !isError && (
            <>
              {/* No-masters notice in All mode */}
              {isAllMode && masters.length === 0 && (
                <Alert>
                  <Layers className="w-4 h-4" />
                  <AlertDescription>
                    No price groups configured. Go to Settings → Price Groups to set up master locations.
                  </AlertDescription>
                </Alert>
              )}

              {/* Stats pill bar */}
              {locationPricedList.length > 0 && (
                <div className="flex flex-wrap gap-3 mb-4">
                  <div className="rounded-lg border bg-muted/40 px-4 py-2 flex items-center gap-3">
                    <Tag className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground leading-none mb-0.5">Total Items</p>
                      <p className="text-base font-semibold leading-none">{locationPricedList.length}</p>
                    </div>
                  </div>
                  <div className="rounded-lg border bg-muted/40 px-4 py-2 flex items-center gap-3">
                    <Check className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground leading-none mb-0.5">Priced</p>
                      <p className="text-base font-semibold leading-none">{locationPricedList.length - unpricedCount}</p>
                    </div>
                  </div>
                  {unpricedCount > 0 && (
                    <div className="rounded-lg border bg-amber-500/10 border-amber-500/30 px-4 py-2 flex items-center gap-3">
                      <EyeOff className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <div>
                        <p className="text-xs text-amber-700 dark:text-amber-400 leading-none mb-0.5">Unpriced</p>
                        <p className="text-base font-semibold leading-none text-amber-700 dark:text-amber-400">{unpricedCount}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {filteredItems.length === 0 && !(isAllMode && masters.length === 0) ? (
                <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-muted-foreground py-16">
                  <Tag className="w-10 h-10 opacity-30" />
                  <p className="text-sm">
                    {showUnpriced && !search && hiddenUnpricedGroups.size === unpricedByGroup.length
                      ? "All groups hidden — click a group chip above to show items."
                      : showUnpriced && !search
                        ? "All items are priced."
                        : search || groupFilter !== "all" || showUnpriced
                          ? "No items match your filters."
                          : "No items found."}
                  </p>
                  {(search || groupFilter !== "all" || showUnpriced) && (
                    <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setGroupFilter("all"); setShowUnpriced(false); setHiddenUnpricedGroups(new Set()); }}>
                      Clear filters
                    </Button>
                  )}
                </div>
              ) : filteredItems.length > 0 ? (
                <>
                  <div className="rounded-xl border">
                    <Table wrapperClassName="max-h-[calc(100vh-280px)]">
                      <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableHead className="w-28 text-xs">Code</TableHead>
                          <TableHead className="text-xs">Item Name</TableHead>
                          <TableHead className="text-xs hidden sm:table-cell">Group</TableHead>
                          {showCostPrice && (
                            <TableHead className="text-xs text-right hidden sm:table-cell w-32">Cost Price</TableHead>
                          )}
                          {showCostPrice && (
                            <TableHead className="text-xs text-right hidden sm:table-cell w-32">Offloading Cost</TableHead>
                          )}

                          {/* All-mode: one column per visible master */}
                          {isAllMode && visibleMasters.map((m) => (
                            <TableHead key={m.id} className="text-xs text-right w-40">{m.name}</TableHead>
                          ))}

                          {/* Single-location mode: one Selling Price column */}
                          {!isAllMode && (
                            <TableHead className="text-xs text-right w-48">Selling Price</TableHead>
                          )}

                          {!isAllMode && (
                            <TableHead className="text-xs text-right hidden sm:table-cell w-28">Qty in Stock</TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredItems.map((item: any) => (
                          <TableRow key={item.stockItemId} data-testid={`row-price-${item.stockItemId}`} className={cn(canEdit && !isAllMode && "group", isItemUnpriced(item) && "bg-amber-50/50 dark:bg-amber-950/20")}>
                            <TableCell className="font-mono text-sm text-muted-foreground">{item.code || "—"}</TableCell>
                            <TableCell>
                              <div className="font-medium">{item.name}</div>
                              {item.stockGroupName && (
                                <div className="text-xs text-muted-foreground sm:hidden">{item.stockGroupName}</div>
                              )}
                            </TableCell>
                            <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                              {item.stockGroupName || "—"}
                            </TableCell>

                            {showCostPrice && (
                              <TableCell className="text-right hidden sm:table-cell text-sm tabular-nums text-muted-foreground" data-testid={`text-cost-${item.stockItemId}`}>
                                {item.costPrice && parseFloat(item.costPrice) > 0 ? formatAmount(parseFloat(item.costPrice)) : "—"}
                              </TableCell>
                            )}
                            {showCostPrice && (
                              <TableCell className="text-right hidden sm:table-cell text-sm tabular-nums text-muted-foreground" data-testid={`text-offloading-cost-${item.stockItemId}`}>
                                {(() => {
                                  const total = parseFloat(item.costPrice ?? "0") + parseFloat(item.offloadingCost ?? "0");
                                  return total > 0 ? formatAmount(total) : "—";
                                })()}
                              </TableCell>
                            )}

                            {/* All-mode: editable price per visible master location */}
                            {isAllMode && visibleMasters.map((m) => {
                              const price = item.masterPrices?.[m.id] ?? item.baseSellingPrice ?? null;
                              const isEditing = editingItem?.stockItemId === item.stockItemId && editingItem?.locationId === m.id;
                              const isSaving = updatePriceMutation.isPending && editingItem?.stockItemId === item.stockItemId && editingItem?.locationId === m.id;
                              return (
                                <TableCell key={m.id} className="text-right">
                                  {isEditing ? (
                                    <div className="flex items-center justify-end gap-1">
                                      <Input
                                        ref={inputRef}
                                        data-testid={`input-price-${item.stockItemId}-${m.id}`}
                                        type="number"
                                        step="0.01"
                                        className="w-24 h-8 text-right tabular-nums"
                                        value={editingItem.value}
                                        onChange={(e) => setEditingItem((prev) => prev ? { ...prev, value: e.target.value } : null)}
                                        onKeyDown={handleKeyDown}
                                        onBlur={handleBlur}
                                        disabled={isSaving}
                                      />
                                      <Button size="icon" variant="ghost" onClick={commitEdit} disabled={isSaving} data-testid={`button-save-price-${item.stockItemId}-${m.id}`}>
                                        <Check className="w-3.5 h-3.5 text-green-600" />
                                      </Button>
                                      <Button size="icon" variant="ghost" onClick={cancelEdit} disabled={isSaving} data-testid={`button-cancel-price-${item.stockItemId}-${m.id}`}>
                                        <X className="w-3.5 h-3.5 text-muted-foreground" />
                                      </Button>
                                    </div>
                                  ) : (
                                    <div
                                      className={cn("flex items-center justify-end gap-1.5 group/cell", canEdit && "cursor-pointer rounded-md px-2 py-1 hover-elevate")}
                                      onClick={() => canEdit && startEdit(item.stockItemId, m.id, price)}
                                      title={canEdit ? `Click to edit ${m.name} price` : undefined}
                                      data-testid={`cell-price-${item.stockItemId}-${m.id}`}
                                    >
                                      <span className="font-semibold tabular-nums">
                                        {price && parseFloat(price) > 0 ? formatAmount(parseFloat(price)) : "—"}
                                      </span>
                                      {canEdit && <Pencil className="w-3 h-3 text-muted-foreground opacity-40 md:opacity-0 md:group-hover/cell:opacity-60 transition-opacity shrink-0" />}
                                    </div>
                                  )}
                                </TableCell>
                              );
                            })}

                            {/* Single-location mode: editable Selling Price */}
                            {!isAllMode && (() => {
                              const isEditing = editingItem?.stockItemId === item.stockItemId;
                              const isSaving = updatePriceMutation.isPending && editingItem?.stockItemId === item.stockItemId;
                              return (
                                <TableCell className="text-right">
                                  {isEditing ? (
                                    <div className="flex items-center justify-end gap-1">
                                      <Input
                                        ref={inputRef}
                                        data-testid={`input-price-${item.stockItemId}`}
                                        type="number"
                                        step="0.01"
                                        className="w-28 h-8 text-right tabular-nums"
                                        value={editingItem!.value}
                                        onChange={(e) => setEditingItem((prev) => prev ? { ...prev, value: e.target.value } : null)}
                                        onKeyDown={handleKeyDown}
                                        onBlur={handleBlur}
                                        disabled={isSaving}
                                      />
                                      <Button size="icon" variant="ghost" data-testid={`button-save-price-${item.stockItemId}`} onClick={commitEdit} disabled={isSaving}>
                                        <Check className="w-3.5 h-3.5 text-green-600" />
                                      </Button>
                                      <Button size="icon" variant="ghost" data-testid={`button-cancel-price-${item.stockItemId}`} onClick={cancelEdit} disabled={isSaving}>
                                        <X className="w-3.5 h-3.5 text-muted-foreground" />
                                      </Button>
                                    </div>
                                  ) : (
                                    <div
                                      className={cn("flex items-center justify-end gap-1.5", canEdit && "group cursor-pointer rounded-md px-2 py-1 hover-elevate")}
                                      data-testid={`cell-price-${item.stockItemId}`}
                                      onClick={() => canEdit && startEdit(item.stockItemId, selectedLocationId!, item.sellingPrice)}
                                      title={canEdit ? "Click to edit price" : undefined}
                                    >
                                      <span className="font-semibold tabular-nums">
                                        {item.sellingPrice ? formatAmount(parseFloat(item.sellingPrice)) : "—"}
                                      </span>
                                      {!item.hasCustomPrice && item.sellingPrice && (
                                        <Badge variant="secondary" className="text-xs hidden sm:inline-flex">base</Badge>
                                      )}
                                      {canEdit && (
                                        <Pencil className="w-3 h-3 text-muted-foreground opacity-40 md:opacity-0 md:group-hover:opacity-60 transition-opacity shrink-0" />
                                      )}
                                    </div>
                                  )}
                                </TableCell>
                              );
                            })()}

                            {!isAllMode && (
                              <TableCell className="text-right hidden sm:table-cell text-sm text-muted-foreground tabular-nums" data-testid={`text-qty-${item.stockItemId}`}>
                                {formatQty(item.quantity)}
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <p className="text-xs text-muted-foreground text-right mt-2" data-testid="text-item-count">
                    Showing {filteredItems.length} of {locationPricedList.length} items
                    {canEdit && <span className="ml-1">· Click any price to edit it{isAllMode && masters.length > 0 ? " (cascades to followers)" : ""}</span>}
                  </p>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* ── Import preview dialog ── */}
      <Dialog open={importDialogOpen} onOpenChange={(open) => { if (!importing) { setImportDialogOpen(open); if (!open) setImportPreview([]); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-4 h-4" />
              Import Price List Preview
            </DialogTitle>
          </DialogHeader>

          {importError && (
            <Alert variant="destructive">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>{importError}</AlertDescription>
            </Alert>
          )}

          {importPreview.length > 0 && (
            <>
              <p className="text-sm text-muted-foreground">
                Ready to update <span className="font-semibold text-foreground">{importPreview.length} items</span> across{" "}
                <span className="font-semibold text-foreground">
                  {new Set(importPreview.flatMap((r) => r.changes.map((c) => c.locationId))).size} location(s)
                </span>.
                Review the changes below before confirming.
              </p>
              <ScrollArea className="h-72 rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Code</TableHead>
                      <TableHead>Item Name</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-right">New Price</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importPreview.slice(0, 200).flatMap((item) =>
                      item.changes.map((c, i) => (
                        <TableRow key={`${item.barcode}-${c.locationId}`}>
                          {i === 0 ? (
                            <>
                              <TableCell className="font-mono text-xs" rowSpan={item.changes.length}>{item.barcode}</TableCell>
                              <TableCell className="text-sm" rowSpan={item.changes.length}>{item.name}</TableCell>
                            </>
                          ) : null}
                          <TableCell>
                            <Badge variant="secondary" className="text-xs">{c.locationName}</Badge>
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{c.price}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                {importPreview.length > 200 && (
                  <p className="text-xs text-muted-foreground text-center py-2">Showing first 200 items…</p>
                )}
              </ScrollArea>
            </>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setImportDialogOpen(false); setImportPreview([]); }} disabled={importing} data-testid="button-import-cancel">
              Cancel
            </Button>
            <Button onClick={handleImportSubmit} disabled={importing || importPreview.length === 0} data-testid="button-import-confirm">
              {importing ? "Uploading…" : `Confirm Upload (${importPreview.length} items)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
