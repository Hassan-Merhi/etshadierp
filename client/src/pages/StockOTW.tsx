import { useState, useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Package, Search, Ship, AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
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
  containerNumber: string;
  supplierName: string;
  importDate: string;
}

export default function StockOTW() {
  const [searchTerm, setSearchTerm] = useState("");

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

  // Apply search filter
  const filteredItems = stockItems.filter((item) => {
    if (searchTerm === "") return true;
    const search = searchTerm.toLowerCase();
    return (
      item.stockItemCode.toLowerCase().includes(search) ||
      item.stockItemName.toLowerCase().includes(search) ||
      item.containerNumber.toLowerCase().includes(search) ||
      item.supplierName.toLowerCase().includes(search)
    );
  });

  // Calculate totals with NaN protection
  const totalQuantity = filteredItems.reduce((sum, item) => {
    const qty = parseFloat(item.quantity || "0");
    return sum + (isNaN(qty) ? 0 : qty);
  }, 0);
  const totalValue = filteredItems.reduce((sum, item) => {
    const val = parseFloat(item.totalCost || "0");
    return sum + (isNaN(val) ? 0 : val);
  }, 0);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="heading-stock-otw">
          Stock On The Way
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
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
              {filteredItems.length}
            </div>
            <p className="text-xs text-muted-foreground">
              Stock items
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
              {totalQuantity.toFixed(3)}
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
            <CardTitle>Stock Items ({filteredItems.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item Code</TableHead>
                    <TableHead>Item Name</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                    <TableHead>Container</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Import Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item, index) => {
                    const qty = parseFloat(item.quantity || "0");
                    const cost = parseFloat(item.totalCost || "0");
                    return (
                      <TableRow key={index} data-testid={`row-item-${index}`}>
                        <TableCell className="font-medium font-mono">
                          {item.stockItemCode}
                        </TableCell>
                        <TableCell>{item.stockItemName}</TableCell>
                        <TableCell className="text-right font-mono">
                          {isNaN(qty) ? "0.000" : qty.toFixed(3)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${isNaN(cost) ? "0.00" : cost.toFixed(2)}
                        </TableCell>
                        <TableCell className="font-mono">
                          {item.containerNumber}
                        </TableCell>
                        <TableCell className="text-sm">{item.supplierName}</TableCell>
                        <TableCell className="font-mono text-sm">
                          {new Date(item.importDate).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            
            <div className="mt-4 pt-4 border-t">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-right">
                  <span className="text-sm text-muted-foreground">Total Quantity:</span>
                  <span className="ml-2 font-mono font-semibold" data-testid="text-summary-quantity">
                    {totalQuantity.toFixed(3)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-sm text-muted-foreground">Total Value:</span>
                  <span className="ml-2 font-mono font-semibold" data-testid="text-summary-value">
                    ${totalValue.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
