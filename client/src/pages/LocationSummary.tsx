import { useState, useEffect, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
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

export default function LocationSummary() {
  const [selectedLocationIds, setSelectedLocationIds] = useState<number[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  });
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);

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

  const sortedLocations = [...locations].sort((a, b) => a.id - b.id);
  const selectedLocations = sortedLocations.filter(loc => selectedLocationIds.includes(loc.id));

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
    if (num === 0) return suffix || "-";
    const formatted = num.toLocaleString('en-US', { 
      minimumFractionDigits: decimals, 
      maximumFractionDigits: decimals 
    });
    return suffix ? `${formatted} ${suffix}` : formatted;
  };

  const colsPerLocation = 3;
  const totalCols = 1 + (selectedLocations.length * colsPerLocation);

  return (
    <div className="p-4 space-y-4">
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
                {sortedLocations.map(location => (
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
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-20">
                <tr className="bg-muted">
                  <th 
                    className="text-left py-1 px-2 font-semibold border-b border-r sticky left-0 bg-muted z-30 min-w-[180px]"
                    rowSpan={2}
                  >
                    Particulars
                  </th>
                  {selectedLocations.map(location => (
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
                  {selectedLocations.map(location => (
                    <Fragment key={`header-${location.id}`}>
                      <th className="text-right py-1 px-1 font-medium border-b w-16 bg-muted/80">Qty (BL)</th>
                      <th className="text-right py-1 px-1 font-medium border-b w-16 bg-muted/80">Rate ($)</th>
                      <th className="text-right py-1 px-1 font-medium border-b border-r w-20 bg-muted/80">Value ($)</th>
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
                            "bg-accent/30 hover:bg-accent/50",
                            groupIndex > 0 && "border-t"
                          )}
                          onClick={() => toggleGroup(group.id)}
                          data-testid={`row-group-${group.id}`}
                        >
                          <td className="py-1 px-2 border-r sticky left-0 bg-accent/30 z-10 font-semibold">
                            <div className="flex items-center gap-1">
                              {expandedGroups.has(group.id) ? (
                                <ChevronDown className="h-3 w-3 flex-shrink-0" />
                              ) : (
                                <ChevronRight className="h-3 w-3 flex-shrink-0" />
                              )}
                              <span className="truncate">{group.name}</span>
                            </div>
                          </td>
                          {selectedLocations.map(location => {
                            const data = group.locationData[location.id] || { quantity: 0, rate: 0, value: 0 };
                            return (
                              <Fragment key={`group-${group.id}-loc-${location.id}`}>
                                <td className="text-right py-1 px-1 tabular-nums font-medium">
                                  {formatNumber(data.quantity, 0, "BL")}
                                </td>
                                <td className="text-right py-1 px-1 tabular-nums text-muted-foreground">
                                  {data.rate === 0 ? "-" : "$" + formatNumber(data.rate, 2)}
                                </td>
                                <td className="text-right py-1 px-1 border-r tabular-nums font-semibold">
                                  {data.value === 0 ? "-" : "$" + formatNumber(data.value, 2)}
                                </td>
                              </Fragment>
                            );
                          })}
                        </tr>
                        {expandedGroups.has(group.id) && group.items.map((item, itemIndex) => (
                          <tr 
                            key={`item-${item.id}`}
                            className={cn(
                              itemIndex % 2 === 0 ? "bg-background" : "bg-muted/30",
                              "hover:bg-accent/20"
                            )}
                            data-testid={`row-item-${item.id}`}
                          >
                            <td className={cn(
                              "py-0.5 pl-6 pr-2 border-r sticky left-0 z-10",
                              itemIndex % 2 === 0 ? "bg-background" : "bg-muted/30"
                            )}>
                              <span className="text-muted-foreground truncate block">{item.name}</span>
                            </td>
                            {selectedLocations.map(location => {
                              const data = item.locationData[location.id] || { quantity: 0, rate: 0, value: 0 };
                              return (
                                <Fragment key={`item-${item.id}-loc-${location.id}`}>
                                  <td className="text-right py-0.5 px-1 tabular-nums">
                                    {formatNumber(data.quantity, 0, "BL")}
                                  </td>
                                  <td className="text-right py-0.5 px-1 tabular-nums text-muted-foreground">
                                    {data.rate === 0 ? "-" : "$" + formatNumber(data.rate, 2)}
                                  </td>
                                  <td className="text-right py-0.5 px-1 border-r tabular-nums">
                                    {data.value === 0 ? "-" : "$" + formatNumber(data.value, 2)}
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
                      {selectedLocations.map(location => {
                        const data = summaryData.grandTotals[location.id] || { quantity: 0, rate: 0, value: 0 };
                        return (
                          <Fragment key={`grand-${location.id}`}>
                            <td className="text-right py-1 px-1 tabular-nums" data-testid={`text-grand-qty-${location.id}`}>
                              {formatNumber(data.quantity, 0, "BL")}
                            </td>
                            <td className="text-right py-1 px-1 tabular-nums text-muted-foreground">
                              {data.rate === 0 ? "-" : "$" + formatNumber(data.rate, 2)}
                            </td>
                            <td className="text-right py-1 px-1 border-r tabular-nums" data-testid={`text-grand-value-${location.id}`}>
                              {data.value === 0 ? "-" : "$" + formatNumber(data.value, 2)}
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
