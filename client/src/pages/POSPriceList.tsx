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
import { Search, MapPin, Tag, AlertCircle, Check, X, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

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
}

interface POSPriceListProps {
  posUser?: any;
}

export default function POSPriceList({ posUser }: POSPriceListProps) {
  const { formatAmount } = useCurrencyContext();
  const { toast } = useToast();
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [editingItem, setEditingItem] = useState<{ stockItemId: number; value: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const {
    data: priceList = [],
    isLoading: priceListLoading,
    isError,
    error,
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
    enabled: !!selectedLocationId,
  });

  const locationPricedList = useMemo(() => {
    if (!posUser) return priceList;
    return priceList.filter((item) => item.hasCustomPrice && item.sellingPrice !== null);
  }, [priceList, posUser]);

  const stockGroups = useMemo(() => {
    const groups = new Set<string>();
    locationPricedList.forEach((item) => {
      if (item.stockGroupName) groups.add(item.stockGroupName);
    });
    return Array.from(groups).sort();
  }, [locationPricedList]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return locationPricedList.filter((item) => {
      const matchesSearch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        (item.code && item.code.toLowerCase().includes(q)) ||
        (item.stockGroupName && item.stockGroupName.toLowerCase().includes(q));
      const matchesGroup =
        groupFilter === "all" || item.stockGroupName === groupFilter;
      return matchesSearch && matchesGroup;
    });
  }, [locationPricedList, search, groupFilter]);

  const selectedLocation = locations.find((l) => l.id === selectedLocationId);

  const updatePriceMutation = useMutation({
    mutationFn: async ({ stockItemId, sellingPrice }: { stockItemId: number; sellingPrice: string }) => {
      const res = await apiRequest("POST", `/api/stock-items/${stockItemId}/location-prices`, {
        locationId: selectedLocationId,
        sellingPrice,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Failed to update price" }));
        throw new Error(body.message || "Failed to update price");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/price-list", selectedLocationId] });
      toast({ title: "Price updated" });
      setEditingItem(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const startEdit = (item: PriceListItem) => {
    if (posUser) return;
    setEditingItem({
      stockItemId: item.stockItemId,
      value: item.sellingPrice ?? item.baseSellingPrice ?? "",
    });
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  const commitEdit = () => {
    if (!editingItem) return;
    const val = editingItem.value.trim();
    if (!val || isNaN(parseFloat(val))) {
      toast({ title: "Invalid price", description: "Enter a valid number.", variant: "destructive" });
      return;
    }
    updatePriceMutation.mutate({ stockItemId: editingItem.stockItemId, sellingPrice: val });
  };

  const cancelEdit = () => setEditingItem(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") cancelEdit();
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Locations sidebar ── */}
      <div className="w-52 shrink-0 border-r flex flex-col overflow-hidden bg-sidebar">
        <div className="flex items-center gap-2 px-3 py-3 border-b">
          <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold text-sidebar-foreground">Locations</span>
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
              {locations.map((loc) => (
                <button
                  key={loc.id}
                  data-testid={`button-location-${loc.id}`}
                  onClick={() => {
                    setSelectedLocationId(loc.id);
                    setSearch("");
                    setGroupFilter("all");
                    setEditingItem(null);
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-md text-sm transition-colors hover-elevate",
                    selectedLocationId === loc.id
                      ? "bg-primary text-primary-foreground font-medium"
                      : "text-sidebar-foreground"
                  )}
                >
                  {loc.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
          <Tag className="w-4 h-4 text-muted-foreground" />
          <h1 className="text-base font-semibold">Price List</h1>
          {selectedLocation && (
            <Badge variant="secondary" className="gap-1">
              <MapPin className="w-3 h-3" />
              {selectedLocation.name}
            </Badge>
          )}
        </div>

        {/* Filters */}
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
            {stockGroups.length > 0 && (
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
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto p-4">
          {/* No location selected */}
          {!selectedLocationId && !locationsLoading && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-muted-foreground">
              <MapPin className="w-10 h-10 opacity-30" />
              <p className="text-sm">Select a location to view prices.</p>
            </div>
          )}

          {/* Error */}
          {isError && (
            <Alert variant="destructive">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>{(error as Error)?.message || "Failed to load price list."}</AlertDescription>
            </Alert>
          )}

          {/* Loading */}
          {selectedLocationId && priceListLoading && (
            <div className="divide-y rounded-md border overflow-hidden">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          )}

          {/* Table */}
          {selectedLocationId && !priceListLoading && !isError && (
            <>
              {filteredItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-muted-foreground py-16">
                  <Tag className="w-10 h-10 opacity-30" />
                  <p className="text-sm">
                    {search || groupFilter !== "all"
                      ? "No items match your search."
                      : "No items found for this location."}
                  </p>
                  {(search || groupFilter !== "all") && (
                    <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setGroupFilter("all"); }}>
                      Clear filters
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <div className="rounded-md border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-28">Code</TableHead>
                          <TableHead>Item Name</TableHead>
                          <TableHead className="hidden sm:table-cell">Group</TableHead>
                          <TableHead className="text-right w-48">Selling Price</TableHead>
                          <TableHead className="text-right hidden sm:table-cell w-28">Qty in Stock</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredItems.map((item) => {
                          const isEditing = editingItem?.stockItemId === item.stockItemId;
                          const isSaving = updatePriceMutation.isPending && editingItem?.stockItemId === item.stockItemId;

                          return (
                            <TableRow
                              key={item.stockItemId}
                              data-testid={`row-price-${item.stockItemId}`}
                              className={cn(!posUser && "group")}
                            >
                              <TableCell className="font-mono text-sm text-muted-foreground">
                                {item.code || "—"}
                              </TableCell>
                              <TableCell>
                                <div className="font-medium">{item.name}</div>
                                {item.stockGroupName && (
                                  <div className="text-xs text-muted-foreground sm:hidden">
                                    {item.stockGroupName}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                                {item.stockGroupName || "—"}
                              </TableCell>

                              {/* ── Editable price cell ── */}
                              <TableCell className="text-right">
                                {isEditing ? (
                                  <div className="flex items-center justify-end gap-1">
                                    <Input
                                      ref={inputRef}
                                      data-testid={`input-price-${item.stockItemId}`}
                                      type="number"
                                      step="0.01"
                                      className="w-28 h-8 text-right tabular-nums"
                                      value={editingItem.value}
                                      onChange={(e) =>
                                        setEditingItem((prev) =>
                                          prev ? { ...prev, value: e.target.value } : null
                                        )
                                      }
                                      onKeyDown={handleKeyDown}
                                      disabled={isSaving}
                                    />
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-8 w-8 shrink-0"
                                      data-testid={`button-save-price-${item.stockItemId}`}
                                      onClick={commitEdit}
                                      disabled={isSaving}
                                    >
                                      <Check className="w-3.5 h-3.5 text-green-600" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-8 w-8 shrink-0"
                                      data-testid={`button-cancel-price-${item.stockItemId}`}
                                      onClick={cancelEdit}
                                      disabled={isSaving}
                                    >
                                      <X className="w-3.5 h-3.5 text-muted-foreground" />
                                    </Button>
                                  </div>
                                ) : (
                                  <div
                                    className={cn(
                                      "flex items-center justify-end gap-1.5",
                                      !posUser && "cursor-pointer rounded-md px-2 py-1 hover-elevate"
                                    )}
                                    data-testid={`cell-price-${item.stockItemId}`}
                                    onClick={() => startEdit(item)}
                                    title={!posUser ? "Click to edit price" : undefined}
                                  >
                                    <span className="font-semibold tabular-nums">
                                      {item.sellingPrice
                                        ? formatAmount(parseFloat(item.sellingPrice))
                                        : "—"}
                                    </span>
                                    {!item.hasCustomPrice && item.sellingPrice && (
                                      <Badge variant="outline" className="text-xs hidden sm:inline-flex">
                                        base
                                      </Badge>
                                    )}
                                    {!posUser && (
                                      <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
                                    )}
                                  </div>
                                )}
                              </TableCell>

                              <TableCell
                                className="text-right hidden sm:table-cell text-sm text-muted-foreground tabular-nums"
                                data-testid={`text-qty-${item.stockItemId}`}
                              >
                                {parseFloat(item.quantity) !== 0 ? item.quantity : "—"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  <p className="text-xs text-muted-foreground text-right mt-2" data-testid="text-item-count">
                    Showing {filteredItems.length} of {locationPricedList.length} items
                    {!posUser && (
                      <span className="ml-1">· Click any price to edit it</span>
                    )}
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
