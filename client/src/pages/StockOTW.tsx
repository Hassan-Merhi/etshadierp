import { useState, useMemo, Fragment } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Package, Search, Ship, AlertCircle, ChevronRight, ChevronDown, Layers, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useLocation, useSearch } from "wouter";
import CombinedInventory from "@/pages/CombinedInventory";
import type { Container, Supplier } from "@shared/schema";
import { PageHeader } from "@/components/PageHeader";

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
  gradeId: number | null;
  gradeName: string | null;
  categoryId: number | null;
  categoryName: string | null;
}

interface GroupedStockItem {
  stockItemName: string;
  totalQuantity: number;
  totalCost: number;
  containerCount: number;
  gradeName: string | null;
  categoryName: string | null;
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
  const [selectedGrade, setSelectedGrade] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const {
    data: containers = [],
    isLoading: loadingContainers,
    error: containersError,
  } = useQuery<Container[]>({
    queryKey: ["/api/containers"],
  });

  const {
    data: suppliers = [],
    error: suppliersError,
  } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const otwContainers = useMemo(
    () => containers.filter((c) => c.status === "OTW"),
    [containers],
  );

  const containerDetailsQueries = useQueries({
    queries: otwContainers.map((container) => ({
      queryKey: [`/api/containers/${container.id}`],
      enabled: !!container.id,
    })),
  });

  const isLoadingDetails = containerDetailsQueries.some((q) => q.isLoading);
  const isLoading = loadingContainers || isLoadingDetails;

  const hasDetailsErrors = containerDetailsQueries.some((q) => q.error);
  const hasErrors = containersError || suppliersError || hasDetailsErrors;

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
              gradeId: item.gradeId ?? null,
              gradeName: item.gradeName ?? null,
              categoryId: item.categoryId ?? null,
              categoryName: item.categoryName ?? null,
            });
          });
        });
      }
    });
    return items;
  }, [containerDetailsQueries, otwContainers, suppliers]);

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
          gradeName: item.gradeName ?? null,
          categoryName: item.categoryName ?? null,
          containers: [],
        });
      }
      const group = grouped.get(name)!;
      if (!group.gradeName && item.gradeName) group.gradeName = item.gradeName;
      if (!group.categoryName && item.categoryName) group.categoryName = item.categoryName;
      group.totalQuantity += isNaN(qty) ? 0 : qty;
      group.totalCost += isNaN(cost) ? 0 : cost;
      const existingContainer = group.containers.find(
        (c) => c.containerNumber === item.containerNumber,
      );
      const itemRate = parseFloat(item.rate || "0");
      if (existingContainer) {
        existingContainer.quantity += isNaN(qty) ? 0 : qty;
        existingContainer.cost += isNaN(cost) ? 0 : cost;
      } else {
        group.containers.push({
          containerNumber: item.containerNumber,
          quantity: isNaN(qty) ? 0 : qty,
          cost: isNaN(cost) ? 0 : cost,
          rate: isNaN(itemRate) ? 0 : itemRate,
          supplierName: item.supplierName,
        });
      }
    });
    grouped.forEach((group) => {
      group.containerCount = group.containers.length;
    });
    return Array.from(grouped.values()).sort((a, b) =>
      a.stockItemName.localeCompare(b.stockItemName)
    );
  }, [stockItems]);

  const gradeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    groupedItems.forEach((item) => {
      if (item.gradeName) seen.set(item.gradeName, item.gradeName);
    });
    return Array.from(seen.values()).sort();
  }, [groupedItems]);

  const categoryOptions = useMemo(() => {
    const seen = new Map<string, string>();
    groupedItems.forEach((item) => {
      if (item.categoryName) seen.set(item.categoryName, item.categoryName);
    });
    return Array.from(seen.values()).sort();
  }, [groupedItems]);

  const filteredItems = groupedItems.filter((item) => {
    if (selectedGrade !== "all" && item.gradeName !== selectedGrade) return false;
    if (selectedCategory !== "all" && item.categoryName !== selectedCategory) return false;
    if (searchTerm === "") return true;
    const search = searchTerm.toLowerCase();
    return (
      item.stockItemName.toLowerCase().includes(search) ||
      (item.gradeName?.toLowerCase().includes(search) ?? false) ||
      (item.categoryName?.toLowerCase().includes(search) ?? false) ||
      item.containers.some(
        (c) =>
          c.containerNumber.toLowerCase().includes(search) ||
          c.supplierName.toLowerCase().includes(search),
      )
    );
  });

  const toggleItemExpanded = (itemName: string) => {
    setExpandedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(itemName)) {
        newSet.delete(itemName);
      } else {
        newSet.add(itemName);
      }
      return newSet;
    });
  };

  const totalQuantity = filteredItems.reduce((sum, item) => sum + item.totalQuantity, 0);
  const totalValue = filteredItems.reduce((sum, item) => sum + item.totalCost, 0);
  const uniqueItemCount = filteredItems.length;

  const containerGrandTotal = otwContainers.reduce(
    (sum, c) => sum + parseFloat((c as any).grandTotal || "0"),
    0,
  );
  const isFiltered = searchTerm.trim() !== "" || selectedGrade !== "all" || selectedCategory !== "all";
  const displayTotal = isFiltered ? totalValue : containerGrandTotal;

  const hasActiveFilters = searchTerm !== "" || selectedGrade !== "all" || selectedCategory !== "all";

  const clearFilters = () => {
    setSearchTerm("");
    setSelectedGrade("all");
    setSelectedCategory("all");
  };

  if (isLoading) {
    return (
      <div className="p-3 sm:p-0 space-y-4 sm:space-y-6">
        <div className="flex flex-wrap gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-32 rounded-lg" />)}
        </div>
        <Skeleton className="h-10 w-full rounded-md" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-0 space-y-4 sm:space-y-6">
      <PageHeader title="Stock On The Way" subtitle="All stock items from containers currently in transit" />

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

      {/* Stats bar */}
      {otwContainers.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 bg-blue-500/10 rounded-lg px-3 py-2">
            <Ship className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-semibold text-blue-700 dark:text-blue-300" data-testid="text-containers-count">
              {otwContainers.length}
            </span>
            <span className="text-xs text-muted-foreground">Containers OTW</span>
          </div>
          <div className="flex items-center gap-2 bg-muted/60 rounded-lg px-3 py-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold" data-testid="text-total-items">{groupedItems.length}</span>
            <span className="text-xs text-muted-foreground">Unique Items</span>
          </div>
          <div className="flex items-center gap-2 bg-muted/60 rounded-lg px-3 py-2">
            <span className="text-sm font-semibold font-mono" data-testid="text-total-quantity">
              {Math.round(groupedItems.reduce((s, i) => s + i.totalQuantity, 0)).toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">Total Qty</span>
          </div>
          <div className="flex items-center gap-2 bg-primary/10 rounded-lg px-3 py-2">
            <span className="text-sm font-semibold font-mono text-primary" data-testid="text-summary-value">
              {formatAmount(containerGrandTotal)}
            </span>
            <span className="text-xs text-muted-foreground">Total Value</span>
          </div>
        </div>
      )}

      {/* Inline filter row */}
      {stockItems.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, container, supplier, grade or category..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search"
            />
          </div>
          {gradeOptions.length > 0 && (
            <Select value={selectedGrade} onValueChange={setSelectedGrade}>
              <SelectTrigger className="w-[140px]" data-testid="select-grade-filter">
                <SelectValue placeholder="All Grades" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Grades</SelectItem>
                {gradeOptions.map((g) => (
                  <SelectItem key={g} value={g}>{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {categoryOptions.length > 0 && (
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-[150px]" data-testid="select-category-filter">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categoryOptions.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>
      )}

      {/* Content */}
      {filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-xl bg-muted/60 flex items-center justify-center mb-4">
            <Ship className="w-7 h-7 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold mb-1">No stock on the way</h2>
          <p className="text-sm text-muted-foreground">
            {stockItems.length === 0
              ? "There are no containers currently in transit"
              : "No items match your search criteria"}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table — borderless card, full-width */}
          <div className="hidden md:block border rounded-xl overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-10 pl-4"></TableHead>
                  <TableHead>Item Name</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Total Cost</TableHead>
                  <TableHead>Supplier</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item, index) => {
                  const isExpanded = expandedItems.has(item.stockItemName);
                  const uniqueSuppliers = Array.from(new Set(item.containers.map((c) => c.supplierName)));
                  return (
                    <Fragment key={item.stockItemName}>
                      <TableRow
                        data-testid={`row-item-${index}`}
                        className="hover-elevate cursor-pointer"
                        onClick={() => toggleItemExpanded(item.stockItemName)}
                      >
                        <TableCell className="pl-4">
                          <Button variant="ghost" size="icon" data-testid={`button-expand-${index}`}>
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell className="font-medium">
                          <div>{item.stockItemName}</div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {item.gradeName && (
                              <Badge variant="outline" className="text-xs" data-testid={`grade-${index}`}>
                                {item.gradeName}
                              </Badge>
                            )}
                            {item.categoryName && (
                              <Badge variant="secondary" className="text-xs" data-testid={`category-${index}`}>
                                {item.categoryName}
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {item.containerCount} container{item.containerCount !== 1 ? "s" : ""}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {Math.round(item.totalQuantity).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatAmount(item.totalCost)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {uniqueSuppliers.length === 1
                            ? uniqueSuppliers[0]
                            : `${uniqueSuppliers[0]} +${uniqueSuppliers.length - 1}`}
                        </TableCell>
                      </TableRow>
                      {isExpanded &&
                        item.containers.map((container, containerIndex) => (
                          <TableRow
                            key={`${item.stockItemName}-${containerIndex}`}
                            className="bg-muted/30"
                            data-testid={`row-container-${index}-${containerIndex}`}
                          >
                            <TableCell className="pl-4"></TableCell>
                            <TableCell className="pl-10 text-sm">
                              <span className="font-mono text-foreground">{container.containerNumber}</span>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {Math.round(container.quantity).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {formatAmount(container.rate)}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{container.supplierName}</TableCell>
                          </TableRow>
                        ))}
                    </Fragment>
                  );
                })}
              </TableBody>
              <TableFooter className="bg-muted/40">
                <TableRow className="font-semibold">
                  <TableCell className="pl-4"></TableCell>
                  <TableCell>Total ({uniqueItemCount} items)</TableCell>
                  <TableCell className="text-right font-mono" data-testid="text-summary-quantity">
                    {Math.round(totalQuantity).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid="text-summary-value">
                    {formatAmount(displayTotal)}
                  </TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {filteredItems.map((item, index) => {
              const isExpanded = expandedItems.has(item.stockItemName);
              const uniqueSuppliers = Array.from(new Set(item.containers.map((c) => c.supplierName)));
              return (
                <div key={item.stockItemName} data-testid={`row-item-${index}`}>
                  <div
                    className="bg-card border rounded-xl p-4 cursor-pointer hover-elevate"
                    onClick={() => toggleItemExpanded(item.stockItemName)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0">
                          <div className="font-medium text-sm">{item.stockItemName}</div>
                          {(item.gradeName || item.categoryName) && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {item.gradeName && (
                                <Badge variant="outline" className="text-xs" data-testid={`grade-mobile-${index}`}>
                                  {item.gradeName}
                                </Badge>
                              )}
                              {item.categoryName && (
                                <Badge variant="secondary" className="text-xs" data-testid={`category-mobile-${index}`}>
                                  {item.categoryName}
                                </Badge>
                              )}
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {item.containerCount} container{item.containerCount !== 1 ? "s" : ""} ·{" "}
                            {uniqueSuppliers.length === 1
                              ? uniqueSuppliers[0]
                              : `${uniqueSuppliers[0]} +${uniqueSuppliers.length - 1}`}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-mono font-semibold">{formatAmount(item.totalCost)}</p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {Math.round(item.totalQuantity).toLocaleString()} units
                        </p>
                      </div>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="ml-4 mt-1 space-y-1">
                      {item.containers.map((container, containerIndex) => (
                        <div
                          key={containerIndex}
                          className="px-4 py-2 rounded-lg bg-muted/40 text-xs flex justify-between items-center"
                          data-testid={`row-container-${index}-${containerIndex}`}
                        >
                          <div>
                            <span className="font-mono font-medium">{container.containerNumber}</span>
                            <span className="ml-2 text-muted-foreground">{container.supplierName}</span>
                          </div>
                          <div className="font-mono text-right">
                            <span>{Math.round(container.quantity).toLocaleString()}</span>
                            <span className="text-muted-foreground mx-1">·</span>
                            <span>{formatAmount(container.cost)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {/* Mobile total row */}
            <div className="bg-muted/40 rounded-xl px-4 py-3 flex justify-between items-center">
              <span className="text-sm font-semibold">Total ({uniqueItemCount} items)</span>
              <div className="text-right">
                <p className="text-sm font-mono font-semibold">{formatAmount(displayTotal)}</p>
                <p className="text-xs text-muted-foreground font-mono">{Math.round(totalQuantity).toLocaleString()} units</p>
              </div>
            </div>
          </div>
        </>
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
      <div className="flex items-center gap-2 px-3 sm:px-6 pt-3 sm:pt-6 pb-0">
        <Button
          size="sm"
          variant={activeTab === "otw" ? "default" : "outline"}
          onClick={() => switchTab("otw")}
          data-testid="tab-stock-otw"
        >
          <Ship className="h-3.5 w-3.5 mr-1.5" />
          Stock OTW
        </Button>
        <Button
          size="sm"
          variant={activeTab === "combined" ? "default" : "outline"}
          onClick={() => switchTab("combined")}
          data-testid="tab-combined-inventory"
        >
          <Layers className="h-3.5 w-3.5 mr-1.5" />
          Combined
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 sm:px-6 pt-4 sm:pt-6">
        {activeTab === "combined" ? <CombinedInventory /> : <StockOTWContent />}
      </div>
    </div>
  );
}
