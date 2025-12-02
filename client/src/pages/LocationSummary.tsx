import { useState, useEffect, Fragment, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, ChevronRight, Settings2, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface LocationData {
  quantity: number;
  rate: number;
  value: number;
}

interface StockItemData {
  id: number;
  code: string;
  name: string;
  uom: string;
  locationData: Record<number, LocationData>;
}

interface StockGroupData {
  id: number;
  code: string;
  name: string;
  locationData: Record<number, LocationData>;
  items: StockItemData[];
}

interface LocationSummaryResponse {
  stockGroups: StockGroupData[];
  grandTotals: Record<number, LocationData>;
  asOfDate: string;
}

interface Location {
  id: number;
  name: string;
  code: string;
}

const STORAGE_KEY = "locationSummary_selectedLocations";
const STATE_KEY = "locationSummary_pageState";

export default function LocationSummary() {
  const [_location, navigate] = useLocation();
  
  // Load saved state from sessionStorage
  const getSavedState = () => {
    try {
      const saved = sessionStorage.getItem(STATE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  };
  
  const savedState = getSavedState();
  
  const [selectedLocationIds, setSelectedLocationIds] = useState<number[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  });
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(() => 
    new Set(savedState?.expandedGroups || [])
  );
  const [asOfDate, setAsOfDate] = useState(() => savedState?.asOfDate || new Date().toISOString().split('T')[0]);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(savedState?.selectedRowKey || null);
  const [highlightedRows, setHighlightedRows] = useState<Set<string>>(() => 
    new Set(savedState?.highlightedRows || [])
  );
  const [selectedLocationIndex, setSelectedLocationIndex] = useState<number>(savedState?.selectedLocationIndex || 0);
  const [hiddenRows, setHiddenRows] = useState<Set<string>>(() => 
    new Set(savedState?.hiddenRows || [])
  );
  const tableScrollContainer = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  
  // Save state to sessionStorage whenever it changes
  useEffect(() => {
    const state = {
      expandedGroups: Array.from(expandedGroups),
      asOfDate,
      selectedRowKey,
      highlightedRows: Array.from(highlightedRows),
      selectedLocationIndex,
      hiddenRows: Array.from(hiddenRows),
      scrollTop: tableScrollContainer.current?.scrollTop || 0,
      scrollLeft: tableScrollContainer.current?.scrollLeft || 0,
    };
    sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
  }, [expandedGroups, asOfDate, selectedRowKey, highlightedRows, selectedLocationIndex, hiddenRows]);
  
  // Restore scroll position on mount
  useEffect(() => {
    if (savedState && tableScrollContainer.current) {
      setTimeout(() => {
        if (tableScrollContainer.current) {
          tableScrollContainer.current.scrollTop = savedState.scrollTop || 0;
          tableScrollContainer.current.scrollLeft = savedState.scrollLeft || 0;
        }
      }, 100);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedLocationIds));
  }, [selectedLocationIds]);

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: summaryData, isLoading } = useQuery<LocationSummaryResponse>({
    queryKey: ["/api/location-summary", { locationIds: selectedLocationIds.join(','), asOfDate }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedLocationIds.length > 0) {
        params.append('locationIds', selectedLocationIds.join(','));
      }
      params.append('asOfDate', asOfDate);
      const res = await fetch(`/api/location-summary?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch location summary');
      return res.json();
    },
    enabled: selectedLocationIds.length > 0,
  });


  // Keep locations in the order they were selected
  const selectedLocations = selectedLocationIds
    .map(id => locations.find(loc => loc.id === id))
    .filter((loc): loc is Location => loc !== undefined);

  const toggleGroup = (groupId: number) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const toggleLocation = (locationId: number) => {
    setSelectedLocationIds(prev => 
      prev.includes(locationId) 
        ? prev.filter(id => id !== locationId)
        : [...prev, locationId]
    );
  };

  const formatNumber = (num: number, decimals: number = 2, suffix: string = "") => {
    if (num === 0) return "";
    const formatted = num.toLocaleString('en-US', { 
      minimumFractionDigits: decimals, 
      maximumFractionDigits: decimals 
    });
    return suffix ? `${formatted} ${suffix}` : formatted;
  };

  const colsPerLocation = 3;
  const totalCols = 1 + (selectedLocations.length * colsPerLocation);

  const buildRowKey = (groupId: number | string, itemId?: number | string) => 
    itemId ? `${groupId}-item-${itemId}` : `group-${groupId}`;

  const getAllRows = () => {
    if (!summaryData?.stockGroups?.length) return [];
    const rows: Array<{ key: string; groupId: number; itemId?: number; groupIndex: number; itemIndex?: number }> = [];
    
    summaryData.stockGroups.forEach((group, groupIndex) => {
      rows.push({ key: buildRowKey(group.id), groupId: group.id, groupIndex });
      if (expandedGroups.has(group.id)) {
        group.items.forEach((item, itemIndex) => {
          rows.push({ key: buildRowKey(group.id, item.id), groupId: group.id, itemId: item.id, groupIndex, itemIndex });
        });
      }
    });
    
    return rows;
  };

  const handleTableKeyDown = (e: KeyboardEvent) => {
    if (locationDialogOpen || !summaryData?.stockGroups?.length) return;
    
    const allRows = getAllRows();
    if (allRows.length === 0) return;
    
    const currentIndex = selectedRowKey ? allRows.findIndex(r => r.key === selectedRowKey) : -1;
    
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (currentIndex > 0) {
        setSelectedRowKey(allRows[currentIndex - 1].key);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (currentIndex === -1) {
        setSelectedRowKey(allRows[0].key);
      } else if (currentIndex < allRows.length - 1) {
        setSelectedRowKey(allRows[currentIndex + 1].key);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setSelectedLocationIndex(prev => Math.max(0, prev - 1));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setSelectedLocationIndex(prev => Math.min(selectedLocations.length - 1, prev + 1))
    } else if (e.key === " ") {
      e.preventDefault();
      if (selectedRowKey) {
        setHighlightedRows(prev => {
          const next = new Set(prev);
          if (next.has(selectedRowKey)) {
            next.delete(selectedRowKey);
          } else {
            next.add(selectedRowKey);
          }
          return next;
        });
      }
    } else if ((e.altKey || e.metaKey) && e.key.toLowerCase() === "r") {
      e.preventDefault();
      if (selectedRowKey) {
        setHiddenRows(prev => {
          const next = new Set(prev);
          if (next.has(selectedRowKey)) {
            next.delete(selectedRowKey);
            toast({ title: "Row unhidden" });
          } else {
            next.add(selectedRowKey);
            toast({ title: "Row hidden (Alt+R)" });
          }
          return next;
        });
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Navigate to LocationMonthlySummary if item row is selected
      if (selectedRowKey && summaryData) {
        const row = allRows.find(r => r.key === selectedRowKey);
        if (row && row.itemId && selectedLocationIndex >= 0 && selectedLocationIndex < selectedLocations.length) {
          const locationId = selectedLocations[selectedLocationIndex].id;
          navigate(`/locations/${locationId}/stock-items/${row.itemId}/history`);
        }
      }
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => handleTableKeyDown(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedRowKey, summaryData, expandedGroups, locationDialogOpen, selectedLocationIndex, selectedLocations, hiddenRows, summaryData]);

  useEffect(() => {
    if (!tableScrollContainer.current) return;
    
    // Scroll to the focused location
    const colWidth = 60; // approx width of each column (3 columns per location)
    const locationWidth = colWidth * 3 + 20; // 3 cols + border
    const scrollPosition = selectedLocationIndex * locationWidth;
    
    tableScrollContainer.current.scrollLeft = scrollPosition;
  }, [selectedLocationIndex]);

  return (
    <div className="p-4 space-y-4" data-testid="location-summary-container">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Location Summary</h1>
          <p className="text-sm text-muted-foreground">
            Stock inventory across locations with expandable stock groups
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Label htmlFor="asOfDate" className="text-sm whitespace-nowrap">As of:</Label>
            <div className="relative">
              <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="asOfDate"
                type="date"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                className="pl-8 w-40"
                data-testid="input-as-of-date"
              />
            </div>
          </div>
          <Dialog open={locationDialogOpen} onOpenChange={setLocationDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-configure-locations">
                <Settings2 className="h-4 w-4 mr-1" />
                Locations ({selectedLocations.length})
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Select Locations to Display</DialogTitle>
              </DialogHeader>
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {locations.map((location: Location) => (
                  <div 
                    key={location.id} 
                    className="flex items-center gap-2 p-2 rounded hover-elevate"
                    data-testid={`checkbox-location-${location.id}`}
                  >
                    <Checkbox
                      id={`loc-${location.id}`}
                      checked={selectedLocationIds.includes(location.id)}
                      onCheckedChange={() => toggleLocation(location.id)}
                    />
                    <Label htmlFor={`loc-${location.id}`} className="flex-1 cursor-pointer text-sm">
                      {location.name}
                    </Label>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setSelectedLocationIds([])}
                  data-testid="button-clear-locations"
                >
                  Clear All
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setSelectedLocationIds(locations.map(l => l.id))}
                  data-testid="button-select-all-locations"
                >
                  Select All
                </Button>
                <Button 
                  size="sm" 
                  onClick={() => setLocationDialogOpen(false)}
                  data-testid="button-done-locations"
                >
                  Done
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {selectedLocations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              Select locations to view inventory summary
            </p>
            <Button 
              variant="outline" 
              className="mt-4"
              onClick={() => setLocationDialogOpen(true)}
              data-testid="button-add-locations-empty"
            >
              <Settings2 className="h-4 w-4 mr-1" />
              Configure Locations
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 200px)' }}>
          <div className="overflow-auto flex-1" ref={tableScrollContainer}>
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-20 bg-muted">
                <tr className="bg-muted">
                  <th 
                    className="text-left py-1 px-2 font-semibold border-b border-r sticky left-0 bg-muted z-30 min-w-[180px]"
                    rowSpan={2}
                  >
                    Particulars
                  </th>
                  {selectedLocations.map((location, locIndex) => (
                    <th 
                      key={location.id} 
                      colSpan={3} 
                      className="text-center py-1 px-1 font-semibold border-b border-r bg-muted"
                    >
                      <span className="truncate block" title={location.name}>
                        {location.name}
                      </span>
                    </th>
                  ))}
                </tr>
                <tr className="bg-muted/80">
                  {selectedLocations.map((location, locIndex) => (
                    <Fragment key={`header-${location.id}`}>
                      <th className="text-right py-1 px-1 font-medium border-b w-56 bg-muted/80">Qty (BL)</th>
                      <th className="text-right py-1 px-1 font-medium border-b w-20 bg-muted/80">Rate ($)</th>
                      <th className="text-right py-1 px-1 font-medium border-b border-r w-24 bg-muted/80">Value ($)</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={totalCols} className="p-8 text-center text-muted-foreground text-sm">
                      Loading...
                    </td>
                  </tr>
                ) : !summaryData?.stockGroups?.length ? (
                  <tr>
                    <td colSpan={totalCols} className="p-8 text-center text-muted-foreground text-sm">
                      No inventory data found for selected locations
                    </td>
                  </tr>
                ) : (
                  <>
                    {summaryData.stockGroups.map((group, groupIndex) => (
                      <Fragment key={`group-${group.id}`}>
                        <tr 
                          className={cn(
                            "cursor-pointer",
                            highlightedRows.has(buildRowKey(group.id)) ? "bg-blue-400 dark:bg-blue-800" : "bg-accent/30 hover:bg-accent/50",
                            groupIndex > 0 && "border-t",
                            selectedRowKey === buildRowKey(group.id) && "ring-2 ring-primary",
                            hiddenRows.has(buildRowKey(group.id)) && "hidden"
                          )}
                          onClick={() => {
                            toggleGroup(group.id);
                            setSelectedRowKey(buildRowKey(group.id));
                          }}
                          onMouseEnter={() => setSelectedRowKey(buildRowKey(group.id))}
                          data-testid={`row-group-${group.id}`}
                        >
                          <td className={cn(
                            "py-1 px-2 border-r sticky left-0 z-10 font-semibold",
                            highlightedRows.has(buildRowKey(group.id)) ? "bg-blue-400 dark:bg-blue-800" : "bg-accent/30"
                          )}>
                            <div className="flex items-center gap-1">
                              {expandedGroups.has(group.id) ? (
                                <ChevronDown className="h-3 w-3 flex-shrink-0" />
                              ) : (
                                <ChevronRight className="h-3 w-3 flex-shrink-0" />
                              )}
                              <span className="truncate">{group.name}</span>
                            </div>
                          </td>
                          {selectedLocations.map((location, locIndex) => {
                            const data = group.locationData[location.id] || { quantity: 0, rate: 0, value: 0 };
                            const isSelectedCell = locIndex === selectedLocationIndex && selectedRowKey === buildRowKey(group.id);
                            return (
                              <Fragment key={`group-${group.id}-loc-${location.id}`}>
                                <td className={cn(
                                  "text-right py-1 px-1 tabular-nums font-medium",
                                  isSelectedCell && "bg-blue-200 dark:bg-blue-800"
                                )}>
                                  {formatNumber(data.quantity, 0, "BL")}
                                </td>
                                <td className={cn(
                                  "text-right py-1 px-1 tabular-nums text-foreground",
                                  isSelectedCell && "bg-blue-200 dark:bg-blue-800"
                                )}>
                                  {data.rate === 0 ? "" : "$" + formatNumber(data.rate, 2)}
                                </td>
                                <td className={cn(
                                  "text-right py-1 px-1 border-r tabular-nums font-semibold",
                                  isSelectedCell && "bg-blue-200 dark:bg-blue-800"
                                )}>
                                  {data.value === 0 ? "" : "$" + formatNumber(data.value, 2)}
                                </td>
                              </Fragment>
                            );
                          })}
                        </tr>
                        {expandedGroups.has(group.id) && [...group.items].sort((a, b) => a.name.localeCompare(b.name)).map((item, itemIndex) => (
                          <tr 
                            key={`item-${item.id}`}
                            className={cn(
                              highlightedRows.has(buildRowKey(group.id, item.id)) 
                                ? "bg-blue-300 dark:bg-blue-700" 
                                : (itemIndex % 2 === 0 ? "bg-background" : "bg-muted/30"),
                              "hover:bg-accent/20 cursor-pointer",
                              selectedRowKey === buildRowKey(group.id, item.id) && "ring-2 ring-primary",
                              hiddenRows.has(buildRowKey(group.id, item.id)) && "hidden"
                            )}
                            onClick={() => setSelectedRowKey(buildRowKey(group.id, item.id))}
                            onMouseEnter={() => setSelectedRowKey(buildRowKey(group.id, item.id))}
                            data-testid={`row-item-${item.id}`}
                          >
                            <td className={cn(
                              "py-0.5 pl-6 pr-2 border-r sticky left-0 z-10 cursor-pointer hover:underline",
                              highlightedRows.has(buildRowKey(group.id, item.id)) 
                                ? "bg-blue-300 dark:bg-blue-700" 
                                : (itemIndex % 2 === 0 ? "bg-background" : "bg-muted/30")
                            )}>
                              <span
                                className="text-blue-500 dark:text-blue-400 truncate block"
                                onClick={() => {
                                  const locationId = selectedLocations[selectedLocationIndex]?.id;
                                  if (locationId) {
                                    navigate(`/locations/${locationId}/stock-items/${item.id}/history`);
                                  }
                                }}
                                data-testid={`link-item-${item.id}`}
                              >
                                {item.name}
                              </span>
                            </td>
                            {selectedLocations.map((location, locIndex) => {
                              const data = item.locationData[location.id] || { quantity: 0, rate: 0, value: 0 };
                              const isSelectedCell = locIndex === selectedLocationIndex && selectedRowKey === buildRowKey(group.id, item.id);
                              const isHighlighted = highlightedRows.has(buildRowKey(group.id, item.id));
                              return (
                                <Fragment key={`item-${item.id}-loc-${location.id}`}>
                                  <td 
                                    className={cn(
                                      "text-right py-0.5 px-1 tabular-nums cursor-pointer hover:bg-accent/30",
                                      isSelectedCell && !isHighlighted && "bg-blue-200 dark:bg-blue-800"
                                    )}
                                    onClick={() => navigate(`/locations/${location.id}/stock-items/${item.id}/history`)}
                                    data-testid={`cell-qty-${item.id}-${location.id}`}
                                  >
                                    {formatNumber(data.quantity, 0, "BL")}
                                  </td>
                                  <td 
                                    className={cn(
                                      "text-right py-0.5 px-1 tabular-nums text-foreground cursor-pointer hover:bg-accent/30",
                                      isSelectedCell && !isHighlighted && "bg-blue-200 dark:bg-blue-800"
                                    )}
                                    onClick={() => navigate(`/locations/${location.id}/stock-items/${item.id}/history`)}
                                    data-testid={`cell-rate-${item.id}-${location.id}`}
                                  >
                                    {data.rate === 0 ? "" : "$" + formatNumber(data.rate, 2)}
                                  </td>
                                  <td 
                                    className={cn(
                                      "text-right py-0.5 px-1 border-r tabular-nums cursor-pointer hover:bg-accent/30",
                                      isSelectedCell && !isHighlighted && "bg-blue-200 dark:bg-blue-800"
                                    )}
                                    onClick={() => navigate(`/locations/${location.id}/stock-items/${item.id}/history`)}
                                    data-testid={`cell-value-${item.id}-${location.id}`}
                                  >
                                    {data.value === 0 ? "" : "$" + formatNumber(data.value, 2)}
                                  </td>
                                </Fragment>
                              );
                            })}
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                    <tr className="font-bold bg-primary/10 border-t-2 border-primary/30">
                      <td className="py-1 px-2 border-r sticky left-0 bg-primary/10 text-primary z-10">
                        Grand Total
                      </td>
                      {selectedLocations.map((location, locIndex) => {
                        const data = summaryData.grandTotals[location.id] || { quantity: 0, rate: 0, value: 0 };
                        return (
                          <Fragment key={`grand-${location.id}`}>
                            <td className="text-right py-1 px-1 tabular-nums" data-testid={`text-grand-qty-${location.id}`}>
                              {formatNumber(data.quantity, 0, "BL")}
                            </td>
                            <td className="text-right py-1 px-1 tabular-nums text-foreground">
                              {data.rate === 0 ? "" : "$" + formatNumber(data.rate, 2)}
                            </td>
                            <td className="text-right py-1 px-1 border-r tabular-nums" data-testid={`text-grand-value-${location.id}`}>
                              {data.value === 0 ? "" : "$" + formatNumber(data.value, 2)}
                            </td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
