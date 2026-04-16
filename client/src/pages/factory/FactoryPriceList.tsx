import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, X, Pencil, Search, Tag, RefreshCw, AlertCircle } from "lucide-react";

interface FactoryBaleProduct {
  id: number;
  code: string;
  articleCode: string | null;
  name: string;
  description: string | null;
  weightPerBaleKg: string | null;
  categoryId: number | null;
  categoryName?: string;
  sellingPrice: string | null;
  productionPrice: string | null;
  active: boolean;
}

interface FactoryCategory {
  id: number;
  name: string;
}

export default function FactoryPriceList() {
  const { toast } = useToast();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [showZeroOnly, setShowZeroOnly] = useState(false);
  const [editingCell, setEditingCell] = useState<{ productId: number; field: "sellingPrice" | "productionPrice"; value: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: products = [], isLoading } = useQuery<FactoryBaleProduct[]>({
    queryKey: ["/api/factory/bale-products"],
  });

  const { data: categories = [] } = useQuery<FactoryCategory[]>({
    queryKey: ["/api/factory/categories"],
  });

  const updatePriceMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: number; field: string; value: string }) => {
      const res = await modeApiRequest("PATCH", `/api/factory/bale-products/${id}`, { [field]: value });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to update price");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });
      setEditingCell(null);
      toast({ title: "Price Updated", description: "Price has been saved and will take effect everywhere." });
    },
    onError: (err: any) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleStartEdit = (product: FactoryBaleProduct, field: "sellingPrice" | "productionPrice") => {
    const currentValue = field === "sellingPrice"
      ? (product.sellingPrice || "0")
      : (product.productionPrice || "0");
    setEditingCell({ productId: product.id, field, value: currentValue });
    setTimeout(() => inputRef.current?.select(), 30);
  };

  const handleSave = () => {
    if (!editingCell) return;
    const val = parseFloat(editingCell.value);
    if (isNaN(val) || val < 0) {
      toast({ title: "Error", description: "Please enter a valid price.", variant: "destructive" });
      return;
    }
    updatePriceMutation.mutate({
      id: editingCell.productId,
      field: editingCell.field === "sellingPrice" ? "sellingPrice" : "productionPrice",
      value: val.toFixed(2),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") setEditingCell(null);
  };

  const filteredProducts = products.filter((p) => {
    if (!p.active) return false;
    const matchSearch = !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.articleCode || "").toLowerCase().includes(search.toLowerCase()) ||
      (p.code || "").toLowerCase().includes(search.toLowerCase());
    const matchCategory = categoryFilter === "all" || String(p.categoryId) === categoryFilter;
    const matchZeroOnly = !showZeroOnly || parseFloat(p.sellingPrice || "0") === 0;
    return matchSearch && matchCategory && matchZeroOnly;
  });

  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

  const updatedCount = products.filter((p) => p.active && parseFloat(p.sellingPrice || "0") > 0).length;
  const totalActive = products.filter((p) => p.active).length;

  return (
    <div className="flex flex-col h-full p-6 space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold" data-testid="text-page-title">Factory Price List</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Set selling prices for all bale products. Changes apply immediately across all proformas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" data-testid="text-price-coverage">
            {updatedCount} / {totalActive} priced
          </Badge>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or article code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
            data-testid="input-search"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-category-filter">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={showZeroOnly ? "default" : "outline"}
          onClick={() => setShowZeroOnly(v => !v)}
          className="gap-2 whitespace-nowrap"
          data-testid="button-show-zero-price-only"
        >
          <AlertCircle className="h-4 w-4" />
          {showZeroOnly ? "Showing unpriced" : "Show unpriced"}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Tag className="h-4 w-4" />
            Product Prices
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filteredProducts.length > 0 ? (
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead>Article Code</TableHead>
                  <TableHead>Product Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Kg / Bale</TableHead>
                  <TableHead className="text-right">Selling Price ($)</TableHead>
                  <TableHead className="text-right">Production Cost ($)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map((product) => {
                  const sellingIsEditing = editingCell?.productId === product.id && editingCell.field === "sellingPrice";
                  const productionIsEditing = editingCell?.productId === product.id && editingCell.field === "productionPrice";
                  const sellingPrice = parseFloat(product.sellingPrice || "0");
                  const productionPrice = parseFloat(product.productionPrice || "0");

                  return (
                    <TableRow key={product.id} data-testid={`row-product-${product.id}`}>
                      <TableCell className="font-mono text-sm" data-testid={`text-article-code-${product.id}`}>
                        {product.articleCode || product.code || "—"}
                      </TableCell>
                      <TableCell className="font-medium" data-testid={`text-product-name-${product.id}`}>
                        {product.name}
                      </TableCell>
                      <TableCell>
                        {product.categoryId
                          ? <Badge variant="outline">{categoryMap.get(product.categoryId) || "—"}</Badge>
                          : <span className="text-muted-foreground text-sm">—</span>
                        }
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">
                        {product.weightPerBaleKg ? `${parseFloat(product.weightPerBaleKg).toFixed(1)} kg` : "—"}
                      </TableCell>

                      {/* Selling Price Cell */}
                      <TableCell className="text-right">
                        {sellingIsEditing ? (
                          <div className="flex items-center justify-end gap-1">
                            <Input
                              ref={inputRef}
                              type="number"
                              min="0"
                              step="0.01"
                              value={editingCell.value}
                              onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                              onKeyDown={handleKeyDown}
                              className="w-28 text-right font-mono"
                              data-testid={`input-selling-price-${product.id}`}
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={handleSave}
                              disabled={updatePriceMutation.isPending}
                              data-testid={`button-save-selling-${product.id}`}
                            >
                              {updatePriceMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5 text-green-600" />}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setEditingCell(null)}
                              data-testid={`button-cancel-selling-${product.id}`}
                            >
                              <X className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        ) : (
                          <div
                            className="flex items-center justify-end gap-2 group cursor-pointer hover-elevate rounded-md px-2 py-1"
                            onClick={() => handleStartEdit(product, "sellingPrice")}
                            data-testid={`cell-selling-price-${product.id}`}
                          >
                            <span className={`font-mono font-medium ${sellingPrice > 0 ? "" : "text-muted-foreground"}`}>
                              {sellingPrice > 0 ? `$${sellingPrice.toFixed(2)}` : "—"}
                            </span>
                            <Pencil className="h-3 w-3 text-muted-foreground opacity-60 md:opacity-0 md:group-hover:opacity-100" />
                          </div>
                        )}
                      </TableCell>

                      {/* Production Cost Cell */}
                      <TableCell className="text-right">
                        {productionIsEditing ? (
                          <div className="flex items-center justify-end gap-1">
                            <Input
                              ref={inputRef}
                              type="number"
                              min="0"
                              step="0.01"
                              value={editingCell.value}
                              onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                              onKeyDown={handleKeyDown}
                              className="w-28 text-right font-mono"
                              data-testid={`input-production-price-${product.id}`}
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={handleSave}
                              disabled={updatePriceMutation.isPending}
                              data-testid={`button-save-production-${product.id}`}
                            >
                              {updatePriceMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5 text-green-600" />}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setEditingCell(null)}
                              data-testid={`button-cancel-production-${product.id}`}
                            >
                              <X className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        ) : (
                          <div
                            className="flex items-center justify-end gap-2 group cursor-pointer hover-elevate rounded-md px-2 py-1"
                            onClick={() => handleStartEdit(product, "productionPrice")}
                            data-testid={`cell-production-price-${product.id}`}
                          >
                            <span className={`font-mono text-sm ${productionPrice > 0 ? "text-muted-foreground" : "text-muted-foreground"}`}>
                              {productionPrice > 0 ? `$${productionPrice.toFixed(2)}` : "—"}
                            </span>
                            <Pencil className="h-3 w-3 text-muted-foreground opacity-60 md:opacity-0 md:group-hover:opacity-100" />
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12">
              <Tag className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No products found</h3>
              <p className="text-muted-foreground mt-2 text-sm">
                {showZeroOnly ? "All products have a selling price set." : search || categoryFilter !== "all" ? "Try adjusting your filters." : "Add bale products to see them here."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="rounded-md bg-muted/50 border p-4 text-sm text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">How prices work:</p>
        <p>Selling prices set here are the catalog prices used across proformas when you click "Apply Catalog Prices."</p>
        <p>On each proforma line you can lock the price — locked lines are skipped when applying catalog prices.</p>
        <p>Production cost is used for profitability reports and is not shown to customers.</p>
      </div>
    </div>
  );
}
