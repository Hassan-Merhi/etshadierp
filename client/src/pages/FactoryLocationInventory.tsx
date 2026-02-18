import { useState, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, MapPin, Layers, Package, Search, Printer, ArrowUpDown } from "lucide-react";
import { useReactToPrint } from "react-to-print";
import { useEscapeBack } from "@/hooks/use-escape-back";

type SortField = "name" | "bales" | "kg" | "value";
type SortDir = "asc" | "desc";

interface Location {
  id: number;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
}

interface FactoryBaleProduct {
  productId: number;
  articleCode: string;
  productName: string;
  category: string | null;
  categoryId: number | null;
  quantity: number;
  totalWeight: number;
  totalCost: number;
  baleCount: number;
}

interface CategoryGroup {
  categoryId: number | null;
  categoryName: string;
  baleCount: number;
  totalWeight: number;
  totalCost: number;
  productCount: number;
  products: FactoryBaleProduct[];
}

function applySortProducts(items: FactoryBaleProduct[], field: SortField, dir: SortDir) {
  return [...items].sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case "name": cmp = a.productName.localeCompare(b.productName); break;
      case "bales": cmp = a.baleCount - b.baleCount; break;
      case "kg": cmp = a.totalWeight - b.totalWeight; break;
      case "value": cmp = a.totalCost - b.totalCost; break;
    }
    return dir === "desc" ? -cmp : cmp;
  });
}

function applySortCategories(items: CategoryGroup[], field: SortField, dir: SortDir) {
  return [...items].sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case "name": cmp = a.categoryName.localeCompare(b.categoryName); break;
      case "bales": cmp = a.baleCount - b.baleCount; break;
      case "kg": cmp = a.totalWeight - b.totalWeight; break;
      case "value": cmp = a.totalCost - b.totalCost; break;
    }
    return dir === "desc" ? -cmp : cmp;
  });
}

export default function FactoryLocationInventory() {
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<CategoryGroup | null>(null);
  const [locationSearch, setLocationSearch] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [catSortField, setCatSortField] = useState<SortField>("name");
  const [catSortDir, setCatSortDir] = useState<SortDir>("asc");
  const [prodSortField, setProdSortField] = useState<SortField>("name");
  const [prodSortDir, setProdSortDir] = useState<SortDir>("asc");
  const printRef = useRef<HTMLDivElement>(null);
  const { formatAmount } = useCurrencyContext();

  const handlePrint = useReactToPrint({ contentRef: printRef });

  const { data: locations = [], isLoading: locationsLoading } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: inventoryData = [], isLoading: inventoryLoading } = useQuery<FactoryBaleProduct[]>({
    queryKey: selectedLocation
      ? [`/api/factory/location-inventory/${selectedLocation.id}`]
      : [],
    queryFn: async () => {
      const response = await fetch(`/api/factory/location-inventory/${selectedLocation!.id}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch factory inventory");
      return response.json();
    },
    enabled: !!selectedLocation,
  });

  const categoryGroups: CategoryGroup[] = inventoryData.reduce((groups, item) => {
    const catId = item.categoryId || 0;
    let group = groups.find((g) => (g.categoryId || 0) === catId);
    if (!group) {
      group = {
        categoryId: item.categoryId,
        categoryName: item.category || "Uncategorized",
        baleCount: 0,
        totalWeight: 0,
        totalCost: 0,
        productCount: 0,
        products: [],
      };
      groups.push(group);
    }
    group.baleCount += item.baleCount;
    group.totalWeight += item.totalWeight;
    group.totalCost += item.totalCost;
    group.productCount += 1;
    group.products.push(item);
    return groups;
  }, [] as CategoryGroup[]);

  const sortedLocations = [...locations].sort((a, b) => a.name.localeCompare(b.name));
  const filteredLocations = sortedLocations.filter((l) =>
    l.name.toLowerCase().includes(locationSearch.toLowerCase())
  );

  const globalSearchResults = useMemo(() => {
    if (!categorySearch.trim() || !inventoryData.length) return null;
    const q = categorySearch.toLowerCase();
    const matched = inventoryData.filter(
      (p) => p.productName.toLowerCase().includes(q) || p.articleCode.toLowerCase().includes(q)
    );
    if (matched.length === 0) return null;
    return matched;
  }, [categorySearch, inventoryData]);

  const filteredCategories = applySortCategories(
    categoryGroups.filter((c) =>
      c.categoryName.toLowerCase().includes(categorySearch.toLowerCase())
    ),
    catSortField,
    catSortDir
  );

  const filteredProducts = selectedCategory
    ? applySortProducts(
        selectedCategory.products.filter(
          (p) => p.productName.toLowerCase().includes(productSearch.toLowerCase()) || p.articleCode.toLowerCase().includes(productSearch.toLowerCase())
        ),
        prodSortField,
        prodSortDir
      )
    : [];

  const handleLocationClick = (location: Location) => {
    setSelectedLocation(location);
    setSelectedCategory(null);
    setCategorySearch("");
    setProductSearch("");
  };

  const handleCategoryClick = (category: CategoryGroup) => {
    setSelectedCategory(category);
    setProductSearch("");
  };

  const handleViewAll = () => {
    const allProducts = inventoryData.slice().sort((a, b) => a.productName.localeCompare(b.productName));
    const totalBales = allProducts.reduce((s, p) => s + p.baleCount, 0);
    const totalWeight = allProducts.reduce((s, p) => s + p.totalWeight, 0);
    const totalCost = allProducts.reduce((s, p) => s + p.totalCost, 0);
    setSelectedCategory({
      categoryId: -1,
      categoryName: "All Items",
      baleCount: totalBales,
      totalWeight,
      totalCost,
      productCount: allProducts.length,
      products: allProducts,
    });
    setProductSearch("");
  };

  const handleBackToLocations = () => {
    setSelectedLocation(null);
    setSelectedCategory(null);
    setLocationSearch("");
    setCategorySearch("");
  };

  const handleBackToCategories = () => {
    setSelectedCategory(null);
    setProductSearch("");
  };

  const escapeBackHandler = selectedCategory
    ? handleBackToCategories
    : selectedLocation
      ? handleBackToLocations
      : null;
  useEscapeBack(escapeBackHandler);

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (!selectedLocation) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <h1 className="text-xl md:text-3xl font-bold mb-6" data-testid="text-page-title">Factory Location Inventory</h1>

        <Card className="p-4 w-full">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Search locations..."
              value={locationSearch}
              onChange={(e) => setLocationSearch(e.target.value)}
              className="pl-10"
              data-testid="input-search-locations"
            />
          </div>

          {locationsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : locations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No locations found.</div>
          ) : (
            <div className="rounded-md border overflow-hidden w-full">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="h-12">
                    <th className="text-left px-3 font-medium">Name</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLocations.length === 0 ? (
                    <tr>
                      <td className="text-center py-8 text-muted-foreground">No locations found matching your search</td>
                    </tr>
                  ) : (
                    filteredLocations.map((location) => (
                      <tr
                        key={location.id}
                        className="border-t hover-elevate cursor-pointer h-12"
                        onClick={() => handleLocationClick(location)}
                        data-testid={`row-location-${location.id}`}
                      >
                        <td className="px-3 font-medium">
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-muted-foreground" />
                            {location.name}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
          {!locationsLoading && filteredLocations.length > 0 && (
            <div className="mt-4 text-sm text-muted-foreground">
              Showing {filteredLocations.length} of {locations.length} locations
            </div>
          )}
        </Card>
      </div>
    );
  }

  if (!selectedCategory) {
    const totalBales = filteredCategories.reduce((s, c) => s + c.baleCount, 0);
    const totalKg = filteredCategories.reduce((s, c) => s + c.totalWeight, 0);
    const totalValue = filteredCategories.reduce((s, c) => s + c.totalCost, 0);
    const totalProducts = filteredCategories.reduce((s, c) => s + c.productCount, 0);

    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-6">
          <h1 className="text-xl md:text-3xl font-bold" data-testid="text-page-title">
            {selectedLocation.name} — Categories
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleBackToLocations} data-testid="button-back-locations">
              <ChevronLeft className="h-4 w-4 mr-1" /> Locations
            </Button>
            <Button variant="default" size="sm" onClick={handleViewAll} data-testid="button-view-all">
              <Package className="h-4 w-4 mr-1" /> View All Items
            </Button>
            <Button variant="outline" size="sm" onClick={() => handlePrint()} data-testid="button-print">
              <Printer className="h-4 w-4 mr-1" /> Print
            </Button>
          </div>
        </div>

        <Card className="p-4 w-full" ref={printRef}>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                placeholder="Search categories or items..."
                value={categorySearch}
                onChange={(e) => setCategorySearch(e.target.value)}
                className="pl-10"
                data-testid="input-search-categories"
              />
            </div>
            <div className="flex items-center gap-2">
              <Select value={catSortField} onValueChange={(v) => setCatSortField(v as SortField)} data-testid="select-cat-sort-field">
                <SelectTrigger className="w-[120px]" data-testid="select-cat-sort-trigger">
                  <ArrowUpDown className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="bales">Bales</SelectItem>
                  <SelectItem value="kg">KG</SelectItem>
                  <SelectItem value="value">Value</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCatSortDir((d) => d === "asc" ? "desc" : "asc")}
                data-testid="button-cat-sort-dir"
              >
                {catSortDir === "asc" ? "\u2191" : "\u2193"}
              </Button>
            </div>
          </div>

          {inventoryLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : globalSearchResults ? (() => {
            const sorted = applySortProducts(globalSearchResults, catSortField, catSortDir);
            const gTotalBales = sorted.reduce((s, p) => s + p.baleCount, 0);
            const gTotalKg = sorted.reduce((s, p) => s + p.totalWeight, 0);
            const gTotalCost = sorted.reduce((s, p) => s + p.totalCost, 0);
            return (
              <>
                <div className="mb-3 text-sm text-muted-foreground">
                  Found {sorted.length} items matching "{categorySearch}" across all categories
                </div>

                <div className="md:hidden space-y-3">
                  {sorted.map((prod) => (
                    <Card key={prod.productId} className="p-3" data-testid={`row-search-result-${prod.productId}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <Package className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{prod.productName}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                        <span>{prod.articleCode}</span>
                        <span>| {prod.category || "Uncategorized"}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div><span className="text-muted-foreground">Bales: </span><span className="font-mono">{prod.baleCount.toLocaleString()}</span></div>
                        <div className="text-right"><span className="text-muted-foreground">KG: </span><span className="font-mono">{fmt(prod.totalWeight)}</span></div>
                        <div className="col-span-2 text-right"><span className="text-muted-foreground">Value: </span><span className="font-mono font-medium">{formatAmount(prod.totalCost)}</span></div>
                      </div>
                    </Card>
                  ))}
                  <Card className="p-3 bg-muted/50" data-testid="text-search-totals">
                    <div className="flex items-center justify-between gap-2 font-bold text-sm">
                      <span>Total ({sorted.length} items, {gTotalBales.toLocaleString()} bales)</span>
                      <span className="font-mono">{fmt(gTotalKg)} KG</span>
                    </div>
                    <div className="text-right text-sm font-mono font-bold mt-1">{formatAmount(gTotalCost)}</div>
                  </Card>
                </div>

                <div className="hidden md:block rounded-md border overflow-hidden w-full">
                  <table className="w-full table-fixed text-sm">
                    <colgroup>
                      <col style={{ width: "130px" }} />
                      <col style={{ width: "120px" }} />
                      <col />
                      <col style={{ width: "90px" }} />
                      <col style={{ width: "110px" }} />
                      <col style={{ width: "130px" }} />
                    </colgroup>
                    <thead className="bg-muted/50">
                      <tr className="h-12">
                        <th className="text-left px-3 font-medium">Category</th>
                        <th className="text-left px-3 font-medium">Article Code</th>
                        <th className="text-left px-3 font-medium">Bale Name</th>
                        <th className="text-right px-3 font-medium">Bales</th>
                        <th className="text-right px-3 font-medium">Total KG</th>
                        <th className="text-right px-3 font-medium">Total Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((prod) => (
                        <tr key={prod.productId} className="border-t h-12" data-testid={`row-search-result-${prod.productId}`}>
                          <td className="px-3 text-muted-foreground text-xs">{prod.category || "Uncategorized"}</td>
                          <td className="px-3 text-muted-foreground font-mono text-xs">{prod.articleCode}</td>
                          <td className="px-3 font-medium">{prod.productName}</td>
                          <td className="text-right px-3 font-mono">{prod.baleCount.toLocaleString()}</td>
                          <td className="text-right px-3 font-mono">{fmt(prod.totalWeight)}</td>
                          <td className="text-right px-3 font-mono">{formatAmount(prod.totalCost)}</td>
                        </tr>
                      ))}
                      <tr className="border-t bg-muted/50 h-12 font-bold">
                        <td className="px-3" colSpan={3}>Total ({sorted.length} items)</td>
                        <td className="text-right px-3 font-mono">{gTotalBales.toLocaleString()}</td>
                        <td className="text-right px-3 font-mono">{fmt(gTotalKg)}</td>
                        <td className="text-right px-3 font-mono">{formatAmount(gTotalCost)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            );
          })() : categoryGroups.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No bales found at this location.</div>
          ) : (
            <>
              <div className="md:hidden space-y-3">
                {filteredCategories.map((cat) => (
                  <Card
                    key={cat.categoryId || 0}
                    className="p-3 cursor-pointer hover-elevate"
                    onClick={() => handleCategoryClick(cat)}
                    data-testid={`row-category-${cat.categoryId || "uncategorized"}`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{cat.categoryName}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="text-muted-foreground">Products: </span><span>{cat.productCount}</span></div>
                      <div className="text-right"><span className="text-muted-foreground">Bales: </span><span className="font-mono">{cat.baleCount.toLocaleString()}</span></div>
                      <div><span className="text-muted-foreground">Total KG: </span><span className="font-mono">{fmt(cat.totalWeight)}</span></div>
                      <div className="text-right"><span className="text-muted-foreground">Value: </span><span className="font-mono">{formatAmount(cat.totalCost)}</span></div>
                    </div>
                  </Card>
                ))}
                {filteredCategories.length > 0 && (
                  <Card className="p-3 bg-muted/50" data-testid="text-category-totals">
                    <div className="flex items-center justify-between gap-2 font-bold text-sm">
                      <span>Total ({totalProducts} products, {totalBales.toLocaleString()} bales)</span>
                      <span className="font-mono">{fmt(totalKg)} KG</span>
                    </div>
                    <div className="text-right text-sm font-mono font-bold mt-1">{formatAmount(totalValue)}</div>
                  </Card>
                )}
              </div>

              <div className="hidden md:block rounded-md border overflow-hidden w-full">
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col />
                    <col style={{ width: "100px" }} />
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "130px" }} />
                    <col style={{ width: "140px" }} />
                  </colgroup>
                  <thead className="bg-muted/50">
                    <tr className="h-12">
                      <th className="text-left px-3 font-medium">Category</th>
                      <th className="text-right px-3 font-medium">Products</th>
                      <th className="text-right px-3 font-medium">Bales</th>
                      <th className="text-right px-3 font-medium">Total KG</th>
                      <th className="text-right px-3 font-medium">Total Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCategories.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-muted-foreground">No categories found matching your search</td>
                      </tr>
                    ) : (
                      <>
                        {filteredCategories.map((cat) => (
                          <tr
                            key={cat.categoryId || 0}
                            className="border-t hover-elevate cursor-pointer h-12"
                            onClick={() => handleCategoryClick(cat)}
                            data-testid={`row-category-${cat.categoryId || "uncategorized"}`}
                          >
                            <td className="px-3 font-medium">
                              <div className="flex items-center gap-2">
                                <Layers className="h-4 w-4 text-muted-foreground" />
                                {cat.categoryName}
                              </div>
                            </td>
                            <td className="text-right px-3 font-mono">{cat.productCount}</td>
                            <td className="text-right px-3 font-mono">{cat.baleCount.toLocaleString()}</td>
                            <td className="text-right px-3 font-mono">{fmt(cat.totalWeight)}</td>
                            <td className="text-right px-3 font-mono">{formatAmount(cat.totalCost)}</td>
                          </tr>
                        ))}
                        <tr className="border-t bg-muted/50 h-12 font-bold">
                          <td className="px-3">Total</td>
                          <td className="text-right px-3 font-mono">{totalProducts}</td>
                          <td className="text-right px-3 font-mono">{totalBales.toLocaleString()}</td>
                          <td className="text-right px-3 font-mono">{fmt(totalKg)}</td>
                          <td className="text-right px-3 font-mono">{formatAmount(totalValue)}</td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {!inventoryLoading && !globalSearchResults && filteredCategories.length > 0 && (
            <div className="mt-4 text-sm text-muted-foreground">
              Showing {filteredCategories.length} of {categoryGroups.length} categories
            </div>
          )}
        </Card>
      </div>
    );
  }

  const isAllItems = selectedCategory.categoryId === -1;
  const totalBales = filteredProducts.reduce((s, p) => s + p.baleCount, 0);
  const totalKg = filteredProducts.reduce((s, p) => s + p.totalWeight, 0);
  const totalCost = filteredProducts.reduce((s, p) => s + p.totalCost, 0);
  const colSpanAll = isAllItems ? 8 : 7;
  const colSpanLabel = isAllItems ? 3 : 2;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-6">
        <h1 className="text-xl md:text-3xl font-bold" data-testid="text-page-title">
          {selectedLocation.name} — {selectedCategory.categoryName}
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleBackToCategories} data-testid="button-back-categories">
            <ChevronLeft className="h-4 w-4 mr-1" /> Categories
          </Button>
          <Button variant="outline" size="sm" onClick={handleBackToLocations} data-testid="button-back-locations">
            <MapPin className="h-4 w-4 mr-1" /> Locations
          </Button>
          <Button variant="outline" size="sm" onClick={() => handlePrint()} data-testid="button-print">
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
        </div>
      </div>

      <Card className="p-4 w-full" ref={printRef}>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Search by bale name or article code..."
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="pl-10"
              data-testid="input-search-products"
            />
          </div>
          <div className="flex items-center gap-2">
            <Select value={prodSortField} onValueChange={(v) => setProdSortField(v as SortField)} data-testid="select-prod-sort-field">
              <SelectTrigger className="w-[120px]" data-testid="select-prod-sort-trigger">
                <ArrowUpDown className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="bales">Bales</SelectItem>
                <SelectItem value="kg">KG</SelectItem>
                <SelectItem value="value">Value</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setProdSortDir((d) => d === "asc" ? "desc" : "asc")}
              data-testid="button-prod-sort-dir"
            >
              {prodSortDir === "asc" ? "\u2191" : "\u2193"}
            </Button>
          </div>
        </div>

        <div className="md:hidden space-y-3">
          {filteredProducts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No products found matching your search</div>
          ) : (
            <>
              {filteredProducts.map((prod) => {
                const avgRate = prod.baleCount > 0 ? prod.totalCost / prod.baleCount : 0;
                const weightPerBale = prod.baleCount > 0 ? prod.totalWeight / prod.baleCount : 0;
                return (
                  <Card key={prod.productId} className="p-3" data-testid={`row-product-${prod.productId}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{prod.productName}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                      <span>{prod.articleCode}</span>
                      {isAllItems && prod.category && (
                        <span className="text-xs text-muted-foreground">| {prod.category}</span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="text-muted-foreground">Bales: </span><span className="font-mono">{prod.baleCount.toLocaleString()}</span></div>
                      <div className="text-right"><span className="text-muted-foreground">Wt/Bale: </span><span className="font-mono">{fmt(weightPerBale)} KG</span></div>
                      <div><span className="text-muted-foreground">Total KG: </span><span className="font-mono">{fmt(prod.totalWeight)}</span></div>
                      <div className="text-right"><span className="text-muted-foreground">Avg Rate: </span><span className="font-mono">{formatAmount(avgRate)}</span></div>
                      <div className="col-span-2 text-right"><span className="text-muted-foreground">Total Value: </span><span className="font-mono font-medium">{formatAmount(prod.totalCost)}</span></div>
                    </div>
                  </Card>
                );
              })}
              <Card className="p-3 bg-muted/50" data-testid="text-product-totals">
                <div className="flex items-center justify-between gap-2 font-bold text-sm">
                  <span>Total ({filteredProducts.length} products, {totalBales.toLocaleString()} bales)</span>
                  <span className="font-mono">{fmt(totalKg)} KG</span>
                </div>
                <div className="text-right text-sm font-mono font-bold mt-1">{formatAmount(totalCost)}</div>
              </Card>
            </>
          )}
        </div>

        <div className="hidden md:block rounded-md border overflow-hidden w-full">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              {isAllItems && <col style={{ width: "130px" }} />}
              <col style={{ width: "120px" }} />
              <col />
              <col style={{ width: "90px" }} />
              <col style={{ width: "110px" }} />
              <col style={{ width: "120px" }} />
              <col style={{ width: "130px" }} />
              <col style={{ width: "130px" }} />
            </colgroup>
            <thead className="bg-muted/50">
              <tr className="h-12">
                {isAllItems && <th className="text-left px-3 font-medium">Category</th>}
                <th className="text-left px-3 font-medium">Article Code</th>
                <th className="text-left px-3 font-medium">Bale Name</th>
                <th className="text-right px-3 font-medium">Bales</th>
                <th className="text-right px-3 font-medium">Wt/Bale (KG)</th>
                <th className="text-right px-3 font-medium">Avg Rate</th>
                <th className="text-right px-3 font-medium">Total Value</th>
                <th className="text-right px-3 font-medium">Total KG</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={colSpanAll} className="text-center py-8 text-muted-foreground">No products found matching your search</td>
                </tr>
              ) : (
                <>
                  {filteredProducts.map((prod) => {
                    const avgRate = prod.baleCount > 0 ? prod.totalCost / prod.baleCount : 0;
                    const weightPerBale = prod.baleCount > 0 ? prod.totalWeight / prod.baleCount : 0;
                    return (
                      <tr key={prod.productId} className="border-t h-12" data-testid={`row-product-${prod.productId}`}>
                        {isAllItems && <td className="px-3 text-muted-foreground text-xs">{prod.category || "Uncategorized"}</td>}
                        <td className="px-3 text-muted-foreground font-mono text-xs">{prod.articleCode}</td>
                        <td className="px-3 font-medium">{prod.productName}</td>
                        <td className="text-right px-3 font-mono">{prod.baleCount.toLocaleString()}</td>
                        <td className="text-right px-3 font-mono">{fmt(weightPerBale)}</td>
                        <td className="text-right px-3 font-mono">{formatAmount(avgRate)}</td>
                        <td className="text-right px-3 font-mono">{formatAmount(prod.totalCost)}</td>
                        <td className="text-right px-3 font-mono">{fmt(prod.totalWeight)}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t bg-muted/50 h-12 font-bold">
                    <td className="px-3" colSpan={colSpanLabel}>Total ({filteredProducts.length} products)</td>
                    <td className="text-right px-3 font-mono">{totalBales.toLocaleString()}</td>
                    <td className="text-right px-3 font-mono"></td>
                    <td className="text-right px-3 font-mono"></td>
                    <td className="text-right px-3 font-mono">{formatAmount(totalCost)}</td>
                    <td className="text-right px-3 font-mono">{fmt(totalKg)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>

        {filteredProducts.length > 0 && (
          <div className="mt-4 text-sm text-muted-foreground">
            Showing {filteredProducts.length} of {selectedCategory.products.length} products
          </div>
        )}
      </Card>
    </div>
  );
}