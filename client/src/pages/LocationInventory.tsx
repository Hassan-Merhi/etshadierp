import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "@/contexts/LocationContext";
import { useLocation as useRoute } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronRight, Package, MapPin, Layers, ShoppingCart, List, Printer } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useReactToPrint } from "react-to-print";

interface Location {
  id: number;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
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
  stockItemBarcode: string | null;
  stockItemUom: string;
  stockGroupId: number | null;
  stockGroupName: string | null;
  stockGroupCode: string | null;
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

export default function LocationInventory({ posUser }: { posUser?: any } = {}) {
  const [selectedLocationLocal, setSelectedLocationLocal] = useState<Location | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<StockGroupSummary | null>(null);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number>(0);
  const [viewAllItems, setViewAllItems] = useState<boolean>(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const { setSelectedLocation } = useLocation();
  const [, navigate] = useRoute();

  // Print handler
  const handlePrint = useReactToPrint({
    contentRef: printRef,
  });

  // Fetch all locations (only if not a POS user)
  const { data: locations = [], isLoading: locationsLoading } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
    enabled: !posUser,
  });

  // For POS users, automatically set their assigned location
  useEffect(() => {
    if (posUser?.assignedLocationId && locations.length > 0) {
      const assignedLocation = locations.find(loc => loc.id === posUser.assignedLocationId);
      if (assignedLocation) {
        setSelectedLocationLocal(assignedLocation);
      }
    }
  }, [posUser, locations]);

  // If POS user, fetch their specific location
  const { data: posLocation } = useQuery<Location>({
    queryKey: posUser?.assignedLocationId ? [`/api/locations/${posUser.assignedLocationId}`] : [],
    enabled: !!posUser?.assignedLocationId,
  });

  // Auto-select location for POS users
  useEffect(() => {
    if (posUser && posLocation && !selectedLocationLocal) {
      setSelectedLocationLocal(posLocation);
    }
  }, [posUser, posLocation, selectedLocationLocal]);

  // Fetch inventory for selected location
  const { data: inventory = [], isLoading: inventoryLoading } = useQuery<InventoryItem[]>({
    queryKey: selectedLocationLocal ? [`/api/locations/${selectedLocationLocal.id}/inventory`] : [],
    enabled: !!selectedLocationLocal,
  });

  // Group inventory by stock group
  const stockGroups: StockGroupSummary[] = inventory.reduce((groups, item) => {
    const groupKey = item.stockGroupId || 0;
    let group = groups.find(g => (g.groupId || 0) === groupKey);
    
    if (!group) {
      group = {
        groupId: item.stockGroupId,
        groupCode: item.stockGroupCode,
        groupName: item.stockGroupName || "Uncategorized",
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

  // Handle location selection
  const handleLocationClick = (location: Location) => {
    setSelectedLocationLocal(location);
    setSelectedGroup(null);
  };

  // Handle selecting a location for use in POS/other modules
  const handleUseLocation = (location: Location) => {
    setSelectedLocation(location);
    navigate("/pos");
  };

  // Handle back to locations
  const handleBackToLocations = () => {
    setSelectedLocationLocal(null);
    setSelectedGroup(null);
    setViewAllItems(false);
  };

  // Handle back to groups
  const handleBackToGroups = () => {
    setSelectedGroup(null);
    setViewAllItems(false);
    setSelectedRowIndex(0);
  };

  // Keyboard navigation for table
  useEffect(() => {
    if (!selectedGroup) return;

    const handleKeyDown = (e: KeyboardEvent) => {
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

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <MapPin className="w-4 h-4" />
        {!selectedLocationLocal && <span>Select Location</span>}
        {selectedLocationLocal && !selectedGroup && !viewAllItems && (
          <>
            {!posUser && (
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
            {!posUser && (
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
            {!posUser && (
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
      {!selectedLocationLocal && (
        <div>
          <h1 className="text-3xl font-bold mb-6">Location Inventory</h1>
          {locationsLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map(i => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-4 w-1/2 mt-2" />
                  </CardHeader>
                </Card>
              ))}
            </div>
          ) : locations.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                No locations found. Create a location first.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {locations.map((location) => (
                <Card
                  key={location.id}
                  className="hover-elevate active-elevate-2 cursor-pointer"
                  onClick={() => handleLocationClick(location)}
                  data-testid={`card-location-${location.id}`}
                >
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MapPin className="w-5 h-5" />
                      {location.name}
                    </CardTitle>
                    <CardDescription>
                      {location.code}
                      {location.city && ` • ${location.city}`}
                      {location.state && `, ${location.state}`}
                    </CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stock Group List View */}
      {selectedLocationLocal && !selectedGroup && !viewAllItems && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-3xl font-bold">
              {selectedLocationLocal.name} - Stock Groups
            </h1>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setViewAllItems(true)}
                data-testid="button-view-all-items"
                variant="outline"
                className="gap-2"
              >
                <List className="w-4 h-4" />
                View All Stock Items
              </Button>
              {!posUser && (
                <Button
                  onClick={() => handleUseLocation(selectedLocationLocal)}
                  data-testid="button-use-location"
                  className="gap-2"
                >
                  <ShoppingCart className="w-4 h-4" />
                  Use Location for POS
                </Button>
              )}
            </div>
          </div>
          {inventoryLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map(i => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-4 w-1/2 mt-2" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-4 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : stockGroups.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                No inventory found at this location.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {stockGroups.map((group) => (
                <Card
                  key={group.groupId || 0}
                  className="hover-elevate active-elevate-2 cursor-pointer"
                  onClick={() => setSelectedGroup(group)}
                  data-testid={`card-group-${group.groupId || 'uncategorized'}`}
                >
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Layers className="w-5 h-5" />
                      {group.groupName}
                    </CardTitle>
                    {group.groupCode && (
                      <CardDescription>{group.groupCode}</CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Items:</span>
                        <span className="font-medium">{group.itemCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total Qty:</span>
                        <span className="font-medium">{group.totalQuantity.toFixed(3)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Avg Rate:</span>
                        <span className="font-medium">${group.averageRate.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total Value:</span>
                        <span className="font-medium text-primary">${group.totalValue.toFixed(2)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stock Items Table View (Single Group) */}
      {selectedLocationLocal && selectedGroup && (
        <div>
          <h1 className="text-3xl font-bold mb-6">
            {selectedGroup.groupName} - Stock Items
          </h1>
          <div ref={tableRef} className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Barcode</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead>UOM</TableHead>
                  <TableHead className="text-right">Avg Rate</TableHead>
                  <TableHead className="text-right">Total Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedGroup.items.map((item, index) => (
                  <TableRow
                    key={item.inventoryId}
                    data-testid={`row-item-${item.stockItemId}`}
                    className={`cursor-pointer ${
                      index === selectedRowIndex
                        ? "bg-accent"
                        : ""
                    }`}
                    onClick={() => setSelectedRowIndex(index)}
                  >
                    <TableCell className="font-medium">{item.stockItemCode}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.stockItemBarcode || "-"}
                    </TableCell>
                    <TableCell>{item.stockItemName}</TableCell>
                    <TableCell className="text-right font-mono">
                      {parseFloat(item.quantity).toFixed(3)}
                    </TableCell>
                    <TableCell>{item.stockItemUom}</TableCell>
                    <TableCell className="text-right font-mono">
                      ${parseFloat(item.averageRate).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      ${parseFloat(item.totalValue).toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* All Stock Items View */}
      {selectedLocationLocal && viewAllItems && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-3xl font-bold">
              {selectedLocationLocal.name} - All Stock Items
            </h1>
            <Button
              onClick={handlePrint}
              data-testid="button-print-inventory"
              variant="default"
              className="gap-2"
            >
              <Printer className="w-4 h-4" />
              Print Inventory
            </Button>
          </div>

          {/* Printable area */}
          <div ref={printRef}>
            {/* Print header (hidden on screen) */}
            <div className="hidden print:block mb-6">
              <h2 className="text-2xl font-bold">{selectedLocationLocal.name}</h2>
              <p className="text-sm text-muted-foreground">Full Inventory Report</p>
              <p className="text-sm text-muted-foreground">
                Printed: {new Date().toLocaleDateString()}
              </p>
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
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Barcode</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Group</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead>UOM</TableHead>
                      {!posUser && (
                        <>
                          <TableHead className="text-right">Avg Rate</TableHead>
                          <TableHead className="text-right">Total Value</TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventory
                      .sort((a, b) => {
                        // Sort by group name, then by item name
                        const groupCompare = (a.stockGroupName || "").localeCompare(b.stockGroupName || "");
                        if (groupCompare !== 0) return groupCompare;
                        return a.stockItemName.localeCompare(b.stockItemName);
                      })
                      .map((item) => (
                        <TableRow
                          key={item.inventoryId}
                          data-testid={`row-all-items-${item.stockItemId}`}
                        >
                          <TableCell className="font-medium">{item.stockItemCode}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {item.stockItemBarcode || "-"}
                          </TableCell>
                          <TableCell>{item.stockItemName}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {item.stockGroupName || "Uncategorized"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {parseFloat(item.quantity).toFixed(3)}
                          </TableCell>
                          <TableCell>{item.stockItemUom}</TableCell>
                          {!posUser && (
                            <>
                              <TableCell className="text-right font-mono">
                                ${parseFloat(item.averageRate).toFixed(2)}
                              </TableCell>
                              <TableCell className="text-right font-mono font-medium">
                                ${parseFloat(item.totalValue).toFixed(2)}
                              </TableCell>
                            </>
                          )}
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Print summary (hidden on screen, visible when printing) */}
            {!posUser && (
              <div className="hidden print:block mt-6">
                <p className="text-sm">
                  Total Items: {inventory.length} | Total Inventory Value: $
                  {inventory.reduce((sum, item) => sum + parseFloat(item.totalValue || "0"), 0).toFixed(2)}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
