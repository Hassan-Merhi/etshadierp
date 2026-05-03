import { useState, useMemo, Fragment } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Package, Search, Ship, AlertCircle, ChevronRight, ChevronDown, Layers } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useLocation, useSearch } from "wouter";
import CombinedInventory from "@/pages/CombinedInventory";
import type { Container, Supplier } from "@shared/schema";

interface ContainerDetailData {
  container: Container;
  pos: any[];
  charges: any[];
}

interface StockItem {
  stockItemCode: string;
  stockItemName: string;
  quantity: string;
  totalCost: string;
  rate: string;
  containerNumber: string;
  supplierName: string;
  importDate: string;
}

interface GroupedStockItem {
  stockItemName: string;
  totalQuantity: number;
  totalCost: number;
  containerCount: number;
  containers: {
    containerNumber: string;
    quantity: number;
    cost: number;
    rate: number;
    supplierName: string;
  }[];
}

function StockOTWContent() {
  const { formatAmount } = useCurrencyContext();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const { 
    data: containers = [], 
    isLoading: loadingContainers,
    error: containersError 
  } = useQuery<Container[]>({
    queryKey: ["/api/containers"],
  });

  const { 
    data: suppliers = [],
    error: suppliersError 
  } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  // Filter only OTW containers
  const otwContainers = useMemo(
    () => containers.filter((c) => c.status === "OTW"),
    [containers]
  );

  // Fetch details for each OTW container using useQueries
  const containerDetailsQueries = useQueries({
    queries: otwContainers.map((container) => ({
      queryKey: [`/api/containers/${container.id}`],
      enabled: !!container.id,
    })),
  });

  const isLoadingDetails = containerDetailsQueries.some((q) => q.isLoading);
  const isLoading = loadingContainers || isLoadingDetails;
  
  // Check for errors
  const hasDetailsErrors = containerDetailsQueries.some((q) => q.error);
  const hasErrors = containersError || suppliersError || hasDetailsErrors;

  // Compile all stock items from OTW containers
  const stockItems: StockItem[] = useMemo(() => {
    const items: StockItem[] = [];
    
    containerDetailsQueries.forEach((query, index) => {
      if (query.data) {
        const containerData = query.data as ContainerDetailData;
        const container = otwContainers[index];
        const supplier = suppliers.find((s) => s.id === container.supplierId);
        
        containerData.pos.forEach((po: any) => {
          po.items.forEach((item: any) => {
            items.push({
              stockItemCode: item.stockItemCode,
              stockItemName: item.stockItemName,
              quantity: item.quantity,
              totalCost: item.totalCost,
              rate: item.rate,
              containerNumber: container.containerNumber,
              supplierName: supplier?.legalName || "Unknown",
              importDate: container.importDate,
            });
          });
        });
      }
    });
    
    return items;
  }, [containerDetailsQueries, otwContainers, suppliers]);

  // Group items by stock item name
  const groupedItems: GroupedStockItem[] = useMemo(() => {
    const grouped = new Map<string, GroupedStockItem>();
    
    stockItems.forEach((item) => {
      const name = item.stockItemName;
      const qty = parseFloat(item.quantity || "0");
      const cost = parseFloat(item.totalCost || "0");
      
      if (!grouped.has(name)) {
        grouped.set(name, {
          stockItemName: name,
          totalQuantity: 0,
          totalCost: 0,
          containerCount: 0,
          containers: [],
        });
      }
      
      const group = grouped.get(name)!;
      group.totalQuantity += isNaN(qty) ? 0 : qty;
      group.totalCost += isNaN(cost) ? 0 : cost;
      
      // Check if this container already exists in the group
      const existingContainer = group.containers.find(
        c => c.containerNumber === item.containerNumber
      );
      
      const itemRate = parseFloat(item.rate || "0");
      if (existingContainer) {
        // Add to existing container
        existingContainer.quantity += isNaN(qty) ? 0 : qty;
        existingContainer.cost += isNaN(cost) ? 0 : cost;
      } else {
        // Add new container
        group.containers.push({
          containerNumber: item.containerNumber,
          quantity: isNaN(qty) ? 0 : qty,
          cost: isNaN(cost) ? 0 : cost,
          rate: isNaN(itemRate) ? 0 : itemRate,
          supplierName: item.supplierName,
        });
      }
    });
    
    // Calculate container count and unique suppliers for each group
    grouped.forEach((group) => {
      group.containerCount = group.containers.length;
    });
    
    return Array.from(grouped.values());
  }, [stockItems]);

  // Apply search filter
  const filteredItems = groupedItems.filter((item) => {
    if (searchTerm === "") return true;
    const search = searchTerm.toLowerCase();
    return (
      item.stockItemName.toLowerCase().includes(search) ||
      item.containers.some(c => 
        c.containerNumber.toLowerCase().includes(search) ||
        c.supplierName.toLowerCase().includes(search)
      )
    );
  });

  const toggleItemExpanded = (itemName: string) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemName)) {
        newSet.delete(itemName);
      } else {
        newSet.add(itemName);
      }
      return newSet;
    });
  };

  // Calculate totals with NaN protection
  const totalQuantity = filteredItems.reduce((sum, item) => sum + item.totalQuantity, 0);
  const totalValue = filteredItems.reduce((sum, item) => sum + item.totalCost, 0);
  const uniqueItemCount = filteredItems.length;

  // Container-level grand total (matches Container Tracking page) — includes freight, charges, discounts
  const containerGrandTotal = otwContainers.reduce(
    (sum, c) => sum + parseFloat((c as any).grandTotal || "0"),
    0,
  );
  // When no search filter is applied, show the authoritative container grand total so both pages agree.
  // When filtered, fall back to the item-level partial total.
  const displayTotal = searchTerm.trim() === "" ? containerGrandTotal : totalValue;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-0 space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold" data-testid="heading-stock-otw">
          Stock On The Way
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          View all stock items from containers currently in transit
        </p>
      </div>

      {hasErrors && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error Loading Data</AlertTitle>
          <AlertDescription>
            {containersError ? "Failed to load containers. " : ""}
            {suppliersError ? "Failed to load suppliers. " : ""}
            {hasDetailsErrors ? "Some container details could not be loaded. " : ""}
            Please try refreshing the page.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Containers OTW</CardTitle>
            <Ship className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-containers-count">
              {otwContainers.length}
            </div>
            <p className="text-xs text-muted-foreground">
              In transit
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Items</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="text-total-items">
              {uniqueItemCount}
            </div>
            <p className="text-xs text-muted-foreground">
              Unique stock items
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Quantity</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="text-total-quantity">
              {Math.round(totalQuantity).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              Total bales/units
            </p>
          </CardContent>
        </Card>
      </div>

      {stockItems.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by code, name, container, or supplier..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
            data-testid="input-search"
          />
        </div>
      )}

      {filteredItems.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Ship className="w-16 h-16 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">No stock on the way</h2>
            <p className="text-muted-foreground">
              {stockItems.length === 0 
                ? "There are no containers currently in transit"
                : "No items match your search criteria"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Stock Items ({uniqueItemCount})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md hidden md:block">
              <Table>
                <TableHeader className="sticky top-0 z-30 bg-background">
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>Item Name</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                    <TableHead>Supplier</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item, index) => {
                    const isExpanded = expandedItems.has(item.stockItemName);
                    return (
                      <Fragment key={item.stockItemName}>
                        <TableRow 
                          data-testid={`row-item-${index}`}
                          className="hover-elevate cursor-pointer"
                          onClick={() => toggleItemExpanded(item.stockItemName)}
                        >
                          <TableCell>
                            <Button 
                              variant="ghost" 
                              size="icon"
                              className="h-6 w-6"
                              data-testid={`button-expand-${index}`}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium">
                            {item.stockItemName}
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {item.containerCount} container{item.containerCount !== 1 ? 's' : ''}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            {Math.round(item.totalQuantity).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatAmount(item.totalCost)}
                          </TableCell>
                          <TableCell className="text-sm">
                            {(() => {
                              const uniqueSuppliers = Array.from(new Set(item.containers.map(c => c.supplierName)));
                              if (uniqueSuppliers.length === 1) {
                                return uniqueSuppliers[0];
                              } else {
                                return `${uniqueSuppliers[0]} +${uniqueSuppliers.length - 1}`;
                              }
                            })()}
                          </TableCell>
                        </TableRow>
                        {isExpanded && item.containers.map((container, containerIndex) => (
                          <TableRow 
                            key={`${item.stockItemName}-${containerIndex}`}
                            className="bg-muted/30"
                            data-testid={`row-container-${index}-${containerIndex}`}
                          >
                            <TableCell></TableCell>
                            <TableCell className="pl-8 text-sm text-muted-foreground">
                              {container.containerNumber}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {Math.round(container.quantity).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {formatAmount(container.rate)}
                            </TableCell>
                            <TableCell className="text-sm">
                              {container.supplierName}
                            </TableCell>
                          </TableRow>
                        ))}
                      </Fragment>
                    );
                  })}
                </TableBody>
                <TableFooter className="sticky bottom-0 z-10 bg-background border-t">
                  <TableRow className="font-semibold">
                    <TableCell></TableCell>
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right font-mono" data-testid="text-summary-quantity">{Math.round(totalQuantity).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono" data-testid="text-summary-value">{formatAmount(displayTotal)}</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>

            <div className="md:hidden space-y-2">
              {filteredItems.map((item, index) => {
                const isExpanded = expandedItems.has(item.stockItemName);
                const uniqueSuppliers = Array.from(new Set(item.containers.map(c => c.supplierName)));
                return (
                  <div key={item.stockItemName} data-testid={`row-item-${index}`}>
                    <div
                      className="p-3 rounded-md border cursor-pointer hover-elevate"
                      onClick={() => toggleItemExpanded(item.stockItemName)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 shrink-0" />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="font-medium text-sm truncate">{item.stockItemName}</div>
                            <div className="text-xs text-muted-foreground">
                              {item.containerCount} container{item.containerCount !== 1 ? 's' : ''} | {uniqueSuppliers.length === 1 ? uniqueSuppliers[0] : `${uniqueSuppliers[0]} +${uniqueSuppliers.length - 1}`}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-between mt-2 text-sm pl-6">
                        <span className="text-muted-foreground">Qty: <span className="font-mono font-semibold text-foreground">{Math.round(item.totalQuantity).toLocaleString()}</span></span>
                        <span className="font-mono">{formatAmount(item.totalCost)}</span>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="ml-6 mt-1 space-y-1">
                        {item.containers.map((container, containerIndex) => (
                          <div
                            key={containerIndex}
                            className="p-2 rounded-md bg-muted/30 text-xs flex justify-between"
                            data-testid={`row-container-${index}-${containerIndex}`}
                          >
                            <div>
                              <span className="text-muted-foreground">{container.containerNumber}</span>
                              <span className="ml-2">{container.supplierName}</span>
                            </div>
                            <div className="font-mono">
                              {Math.round(container.quantity).toLocaleString()} | {formatAmount(container.cost)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function StockOTW() {
  const [location, navigate] = useLocation();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const activeTab = params.get("tab") || "otw";

  const switchTab = (tab: string) => {
    navigate(tab === "otw" ? location : `${location}?tab=${tab}`);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-3 sm:px-6 pt-3 sm:pt-6 pb-0">
        <div className="flex items-center gap-1 rounded-md border p-1">
          <Button
            size="sm"
            variant={activeTab === "otw" ? "secondary" : "ghost"}
            onClick={() => switchTab("otw")}
            data-testid="tab-stock-otw"
          >
            <Ship className="h-3.5 w-3.5 mr-1.5" />
            Stock OTW
          </Button>
          <Button
            size="sm"
            variant={activeTab === "combined" ? "secondary" : "ghost"}
            onClick={() => switchTab("combined")}
            data-testid="tab-combined-inventory"
          >
            <Layers className="h-3.5 w-3.5 mr-1.5" />
            Combined
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {activeTab === "combined" ? <CombinedInventory /> : <StockOTWContent />}
      </div>
    </div>
  );
}
