import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronRight, Package, MapPin, Layers } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

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

export default function LocationInventory() {
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<StockGroupSummary | null>(null);

  // Fetch all locations
  const { data: locations = [], isLoading: locationsLoading } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  // Fetch inventory for selected location
  const { data: inventory = [], isLoading: inventoryLoading } = useQuery<InventoryItem[]>({
    queryKey: ["/api/locations", selectedLocation?.id, "inventory"],
    enabled: !!selectedLocation,
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
    setSelectedLocation(location);
    setSelectedGroup(null);
  };

  // Handle back to locations
  const handleBackToLocations = () => {
    setSelectedLocation(null);
    setSelectedGroup(null);
  };

  // Handle back to groups
  const handleBackToGroups = () => {
    setSelectedGroup(null);
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <MapPin className="w-4 h-4" />
        {!selectedLocation && <span>Select Location</span>}
        {selectedLocation && !selectedGroup && (
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
            <span>{selectedLocation.name}</span>
          </>
        )}
        {selectedLocation && selectedGroup && (
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
            <Button
              variant="ghost"
              onClick={handleBackToGroups}
              className="h-auto p-0 text-sm hover:underline"
              data-testid="button-back-to-groups"
            >
              {selectedLocation.name}
            </Button>
            <ChevronRight className="w-4 h-4" />
            <span>{selectedGroup.groupName}</span>
          </>
        )}
      </div>

      {/* Location List View */}
      {!selectedLocation && (
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
      {selectedLocation && !selectedGroup && (
        <div>
          <h1 className="text-3xl font-bold mb-6">
            {selectedLocation.name} - Stock Groups
          </h1>
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

      {/* Stock Items List View */}
      {selectedLocation && selectedGroup && (
        <div>
          <h1 className="text-3xl font-bold mb-6">
            {selectedGroup.groupName} - Stock Items
          </h1>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {selectedGroup.items.map((item) => (
              <Card key={item.inventoryId} data-testid={`card-item-${item.stockItemId}`}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Package className="w-5 h-5" />
                    {item.stockItemName}
                  </CardTitle>
                  <CardDescription>
                    {item.stockItemCode}
                    {item.stockItemBarcode && ` • ${item.stockItemBarcode}`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Quantity:</span>
                      <span className="font-medium">{parseFloat(item.quantity).toFixed(3)} {item.stockItemUom}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Avg Rate:</span>
                      <span className="font-medium">${parseFloat(item.averageRate).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Value:</span>
                      <span className="font-medium text-primary">${parseFloat(item.totalValue).toFixed(2)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
