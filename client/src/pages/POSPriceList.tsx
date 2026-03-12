import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, MapPin, Tag, AlertCircle, CheckCircle2 } from "lucide-react";

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
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>("all");

  // Fetch assigned locations (POS users get only their locations, others get all)
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

  // Auto-select when only one location
  useEffect(() => {
    if (locations.length === 1 && selectedLocationId === null) {
      setSelectedLocationId(locations[0].id);
    }
  }, [locations, selectedLocationId]);

  // Fetch price list for the selected location
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

  // For POS users: only keep items that have a price set specifically for their location.
  // Items that only have a base/fallback price (no location-specific entry) are hidden.
  const locationPricedList = useMemo(() => {
    if (!posUser) return priceList;
    return priceList.filter((item) => item.hasCustomPrice && item.sellingPrice !== null);
  }, [priceList, posUser]);

  // Collect all unique stock groups for the filter (from location-priced list only)
  const stockGroups = useMemo(() => {
    const groups = new Set<string>();
    locationPricedList.forEach((item) => {
      if (item.stockGroupName) groups.add(item.stockGroupName);
    });
    return Array.from(groups).sort();
  }, [locationPricedList]);

  // Apply search + group filter
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 p-4 border-b shrink-0">
        <Tag className="w-5 h-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Price List</h1>
        {selectedLocation && (
          <Badge variant="secondary" className="ml-1 gap-1">
            <MapPin className="w-3 h-3" />
            {selectedLocation.name}
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-3 p-4 flex-1 min-h-0 overflow-auto">
        {/* Controls row */}
        <div className="flex flex-wrap gap-2">
          {/* Location selector */}
          {locationsLoading ? (
            <Skeleton className="h-9 w-48" />
          ) : locations.length > 1 ? (
            <Select
              value={selectedLocationId?.toString() ?? ""}
              onValueChange={(val) => setSelectedLocationId(parseInt(val))}
            >
              <SelectTrigger
                data-testid="select-location"
                className="w-48"
              >
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id.toString()}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : locations.length === 1 ? null : (
            <Alert variant="destructive" className="flex-1">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>No locations assigned to your account.</AlertDescription>
            </Alert>
          )}

          {/* Search */}
          {selectedLocationId && (
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                data-testid="input-price-search"
                className="pl-8"
                placeholder="Search by name or code…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          )}

          {/* Group filter */}
          {selectedLocationId && stockGroups.length > 0 && (
            <Select value={groupFilter} onValueChange={setGroupFilter}>
              <SelectTrigger data-testid="select-group-filter" className="w-44">
                <SelectValue placeholder="All groups" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All groups</SelectItem>
                {stockGroups.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* No location selected */}
        {!selectedLocationId && !locationsLoading && locations.length > 0 && (
          <div className="flex flex-col items-center justify-center flex-1 text-center gap-2 text-muted-foreground py-16">
            <MapPin className="w-10 h-10 opacity-30" />
            <p className="text-sm">Select a location to view prices.</p>
          </div>
        )}

        {/* Error state */}
        {isError && (
          <Alert variant="destructive">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>
              {(error as Error)?.message || "Failed to load price list."}
            </AlertDescription>
          </Alert>
        )}

        {/* Loading state */}
        {selectedLocationId && priceListLoading && (
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Price list table */}
        {selectedLocationId && !priceListLoading && !isError && (
          <>
            {filteredItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center flex-1 text-center gap-2 text-muted-foreground py-16">
                <Tag className="w-10 h-10 opacity-30" />
                <p className="text-sm">
                  {search || groupFilter !== "all"
                    ? "No items match your search."
                    : "No items found for this location."}
                </p>
                {(search || groupFilter !== "all") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setSearch(""); setGroupFilter("all"); }}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            ) : (
              <Card>
                <CardContent className="p-0 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-28">Code</TableHead>
                        <TableHead>Item Name</TableHead>
                        <TableHead className="hidden sm:table-cell">Group</TableHead>
                        <TableHead className="text-right">Selling Price</TableHead>
                        <TableHead className="text-right hidden sm:table-cell">Qty in Stock</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredItems.map((item) => (
                        <TableRow key={item.stockItemId} data-testid={`row-price-${item.stockItemId}`}>
                          <TableCell className="font-mono text-sm text-muted-foreground">
                            {item.code || "—"}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{item.name}</div>
                            {/* Show group on mobile */}
                            {item.stockGroupName && (
                              <div className="text-xs text-muted-foreground sm:hidden">
                                {item.stockGroupName}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                            {item.stockGroupName || "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <span className="font-semibold tabular-nums">
                                {item.sellingPrice
                                  ? formatAmount(parseFloat(item.sellingPrice))
                                  : "—"}
                              </span>
                              {!item.hasCustomPrice && item.sellingPrice && (
                                <Badge
                                  variant="outline"
                                  className="text-xs hidden sm:inline-flex"
                                  data-testid={`badge-base-price-${item.stockItemId}`}
                                >
                                  base
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell
                            className="text-right hidden sm:table-cell text-sm text-muted-foreground tabular-nums"
                            data-testid={`text-qty-${item.stockItemId}`}
                          >
                            {parseFloat(item.quantity) !== 0 ? item.quantity : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* Footer summary */}
            {filteredItems.length > 0 && (
              <p
                className="text-xs text-muted-foreground text-right"
                data-testid="text-item-count"
              >
                Showing {filteredItems.length} of {locationPricedList.length} items
                {!posUser && (
                  <span className="ml-1 text-muted-foreground">
                    · Prices marked "base" use the item default price (no custom location price set)
                  </span>
                )}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
