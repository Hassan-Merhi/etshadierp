import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useCompany } from "@/contexts/CompanyContext";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft, MapPin, Layers, Package, Search, Printer, ArrowUpDown,
  FileText, ClipboardList, X, Download, FileSpreadsheet, Plus, Check
} from "lucide-react";
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
  sellingPrice: string;
}

interface CategoryGroup {
  categoryId: number | null;
  categoryName: string;
  baleCount: number;
  totalWeight: number;
  totalCost: number;
  totalSellValue: number;
  productCount: number;
  products: FactoryBaleProduct[];
}

interface ProformaSelection {
  productId: number;
  articleCode: string;
  productName: string;
  availableBales: number;
  selectedQty: number;
  pricePerBale: string;
}

interface Customer {
  id: number;
  legalName: string;
  balance: number;
  balanceSide: string;
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
  const [_loc, navigate] = useLocation();
  const printRef = useRef<HTMLDivElement>(null);
  const { formatAmount } = useCurrencyContext();
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);

  const [proformaMode, setProformaMode] = useState(false);
  const [selections, setSelections] = useState<Map<number, ProformaSelection>>(new Map());
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [proformaName, setProformaName] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [savedProformaId, setSavedProformaId] = useState<number | null>(null);

  // Edit-mode state (deep-link from CustomerProformas "Edit in Inventory")
  const [editingProformaId, setEditingProformaId] = useState<number | null>(null);
  const [editProformaLines, setEditProformaLines] = useState<Array<{ articleCode: string; quantity: number; pricePerBale: string }>>([]);
  const [editModeInitialized, setEditModeInitialized] = useState(false);

  const handlePrint = useReactToPrint({ contentRef: printRef });

  const { data: locations = [], isLoading: locationsLoading } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: myAccess } = useQuery<{ fullAccess: boolean; pageKeys: string[]; hasErpAccess: boolean; hasFactoryAccess: boolean; hiddenCostFields: string[] }>({
    queryKey: ["/api/factory/my-access"],
  });
  const hiddenCost = myAccess?.hiddenCostFields ?? [];
  const hideAvgRate = hiddenCost.includes("inventory_avg_rate");
  const hideTotalValue = hiddenCost.includes("inventory_total_value");

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

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/factory/customers", selectedCompany?.id],
    enabled: !!selectedCompany?.id && finalizeOpen,
  });

  const createCustomerMutation = useMutation({
    mutationFn: async (data: { legalName: string }) => {
      return await modeApiRequest("POST", "/api/factory/customers", data);
    },
    onSuccess: (newCustomer: any) => {
      toast({ title: "Customer created" });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customers", selectedCompany?.id] });
      setSelectedCustomerId(String(newCustomer.id));
      setShowCreateCustomer(false);
      setNewCustomerName("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const bulkCreateMutation = useMutation({
    mutationFn: async (data: { customerId: number; name: string; isActive: boolean; lines: any[] }) => {
      const res = await modeApiRequest("POST", "/api/factory/customer-proformas/bulk", data);
      return await res.json();
    },
    onSuccess: (result: any) => {
      setSavedProformaId(result.id);
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customer-proformas"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const replaceLinesMutation = useMutation({
    mutationFn: async (data: { id: number; lines: any[] }) => {
      const res = await modeApiRequest("PUT", `/api/factory/customer-proformas/${data.id}/replace-lines`, { lines: data.lines });
      return await res.json();
    },
    onSuccess: (result: any) => {
      toast({ title: "Proforma updated", description: "Lines saved successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customer-proformas"] });
      setSavedProformaId(result.id);
      setTimeout(() => navigate("/factory/sales/proformas"), 800);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // On mount: read URL params for edit-mode deep-link
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const editId = params.get("editProformaId");
    const editName = params.get("editProformaName");
    const editCustId = params.get("editCustomerId");
    if (editId && editName && editCustId) {
      const proformaId = parseInt(editId);
      setEditingProformaId(proformaId);
      setProformaName(decodeURIComponent(editName));
      setSelectedCustomerId(editCustId);
      setProformaMode(true);
      // Fetch existing proforma lines to pre-populate inventory selections
      fetch(`/api/factory/customer-proformas?customerId=${editCustId}`, { credentials: "include" })
        .then((r) => r.json())
        .then((proformas: any[]) => {
          const found = proformas.find((p: any) => p.id === proformaId);
          if (found?.lines?.length) {
            setEditProformaLines(found.lines.map((l: any) => ({
              articleCode: l.articleCode,
              quantity: l.quantity,
              pricePerBale: l.pricePerBale,
            })));
          }
        })
        .catch(() => {});
    }
  }, []);

  // When inventory loads in edit mode, pre-populate selections from existing proforma lines
  useEffect(() => {
    if (!editingProformaId || editProformaLines.length === 0 || inventoryData.length === 0 || editModeInitialized) return;
    const lineMap = new Map(editProformaLines.map((l) => [l.articleCode, l]));
    const newSelections = new Map<number, ProformaSelection>();
    (inventoryData as any[]).forEach((prod: any) => {
      const line = lineMap.get(prod.articleCode);
      if (line) {
        newSelections.set(prod.productId, {
          productId: prod.productId,
          articleCode: prod.articleCode,
          productName: prod.productName,
          availableBales: prod.baleCount,
          selectedQty: Math.min(line.quantity, prod.baleCount),
          pricePerBale: line.pricePerBale,
        });
      }
    });
    if (newSelections.size > 0) setSelections(newSelections);
    setEditModeInitialized(true);
  }, [editingProformaId, editProformaLines, inventoryData, editModeInitialized]);

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
        totalSellValue: 0,
        productCount: 0,
        products: [],
      };
      groups.push(group);
    }
    group.baleCount += item.baleCount;
    group.totalWeight += item.totalWeight;
    group.totalCost += item.totalCost;
    group.totalSellValue += item.baleCount * parseFloat(item.sellingPrice || "0");
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
          (p) => {
            const matchesSearch = p.productName.toLowerCase().includes(productSearch.toLowerCase()) || p.articleCode.toLowerCase().includes(productSearch.toLowerCase());
            if (proformaMode && showSelectedOnly) return matchesSearch && selections.has(p.productId);
            return matchesSearch;
          }
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
    setProformaMode(false);
    setSelections(new Map());
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

  const toggleProformaMode = useCallback(() => {
    if (proformaMode) {
      setProformaMode(false);
      setSelections(new Map());
      setShowSelectedOnly(false);
    } else {
      setProformaMode(true);
    }
  }, [proformaMode]);

  const selectAllVisible = useCallback(() => {
    setSelections((prev) => {
      const next = new Map(prev);
      filteredProducts.forEach((prod) => {
        if (!next.has(prod.productId)) {
          next.set(prod.productId, {
            productId: prod.productId,
            articleCode: prod.articleCode,
            productName: prod.productName,
            availableBales: prod.baleCount,
            selectedQty: prod.baleCount,
            pricePerBale: prod.sellingPrice || "0",
          });
        }
      });
      return next;
    });
  }, [filteredProducts]);

  const deselectAllVisible = useCallback(() => {
    setSelections((prev) => {
      const next = new Map(prev);
      filteredProducts.forEach((prod) => next.delete(prod.productId));
      return next;
    });
    setShowSelectedOnly(false);
  }, [filteredProducts]);

  const toggleSelection = useCallback((prod: FactoryBaleProduct) => {
    setSelections((prev) => {
      const next = new Map(prev);
      if (next.has(prod.productId)) {
        next.delete(prod.productId);
      } else {
        next.set(prod.productId, {
          productId: prod.productId,
          articleCode: prod.articleCode,
          productName: prod.productName,
          availableBales: prod.baleCount,
          selectedQty: prod.baleCount,
          pricePerBale: prod.sellingPrice || "0",
        });
      }
      return next;
    });
  }, []);

  const updateSelectionQty = useCallback((productId: number, qty: string) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const existing = next.get(productId);
      if (existing) {
        const parsed = parseInt(qty);
        next.set(productId, { ...existing, selectedQty: isNaN(parsed) ? 0 : Math.max(0, Math.min(parsed, existing.availableBales)) });
      }
      return next;
    });
  }, []);

  const updateSelectionPrice = useCallback((productId: number, price: string) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const existing = next.get(productId);
      if (existing) {
        next.set(productId, { ...existing, pricePerBale: price });
      }
      return next;
    });
  }, []);

  const updateFinalizePrice = useCallback((productId: number, price: string) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const existing = next.get(productId);
      if (existing) {
        next.set(productId, { ...existing, pricePerBale: price });
      }
      return next;
    });
  }, []);

  const updateFinalizeQty = useCallback((productId: number, qty: string) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const existing = next.get(productId);
      if (existing) {
        const parsed = parseInt(qty);
        next.set(productId, { ...existing, selectedQty: isNaN(parsed) ? 0 : Math.max(0, Math.min(parsed, existing.availableBales)) });
      }
      return next;
    });
  }, []);

  const removeFromFinalize = useCallback((productId: number) => {
    setSelections((prev) => {
      const next = new Map(prev);
      next.delete(productId);
      return next;
    });
  }, []);

  const selectedItems = Array.from(selections.values()).filter((s) => s.selectedQty > 0);
  const grandTotal = selectedItems.reduce((sum, item) => sum + item.selectedQty * parseFloat(item.pricePerBale || "0"), 0);
  const totalSelectedBales = selectedItems.reduce((sum, item) => sum + item.selectedQty, 0);

  const handleFinalize = () => {
    if (selectedItems.length === 0) {
      toast({ title: "No items selected", description: "Select at least one item with quantity > 0", variant: "destructive" });
      return;
    }
    setSavedProformaId(null);
    setFinalizeOpen(true);
  };

  const handleSaveProforma = () => {
    if (!selectedCustomerId) {
      toast({ title: "Select a customer", variant: "destructive" });
      return;
    }
    if (!proformaName.trim()) {
      toast({ title: "Enter a proforma name", variant: "destructive" });
      return;
    }
    const lines = selectedItems.map((item) => ({
      articleCode: item.articleCode,
      productName: item.productName,
      quantity: item.selectedQty,
      pricePerBale: item.pricePerBale,
    }));
    if (editingProformaId) {
      replaceLinesMutation.mutate({ id: editingProformaId, lines });
    } else {
      bulkCreateMutation.mutate({
        customerId: parseInt(selectedCustomerId),
        name: proformaName.trim(),
        isActive: false,
        lines,
      });
    }
  };

  const handleExportExcel = () => {
    if (!savedProformaId) return;
    window.open(`/api/factory/customer-proformas/${savedProformaId}/export/excel`, "_blank");
  };

  const handleExportPdf = () => {
    if (!savedProformaId) return;
    window.open(`/api/factory/customer-proformas/${savedProformaId}/export/pdf`, "_blank");
  };

  const handleCloseFinalizeDialog = () => {
    setFinalizeOpen(false);
    if (savedProformaId) {
      setProformaMode(false);
      setSelections(new Map());
      setSavedProformaId(null);
      setProformaName("");
      setSelectedCustomerId("");
    }
  };

  const filteredCustomers = customers.filter((c) =>
    c.legalName.toLowerCase().includes(customerSearch.toLowerCase())
  );

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });

  const renderFinalizeDialog = () => (
    <Dialog open={finalizeOpen} onOpenChange={(open) => { if (!open) handleCloseFinalizeDialog(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-finalize-title">
            {savedProformaId ? "Proforma Saved" : "Finalize Proforma"}
          </DialogTitle>
        </DialogHeader>

        {!savedProformaId ? (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Proforma Name</label>
              <Input
                placeholder="e.g. March 2026 Order"
                value={proformaName}
                onChange={(e) => setProformaName(e.target.value)}
                data-testid="input-proforma-name"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Customer</label>
              {showCreateCustomer ? (
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Customer name..."
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    className="flex-1"
                    data-testid="input-new-customer-name"
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      if (newCustomerName.trim()) createCustomerMutation.mutate({ legalName: newCustomerName.trim() });
                    }}
                    disabled={!newCustomerName.trim() || createCustomerMutation.isPending}
                    data-testid="button-save-new-customer"
                  >
                    <Check className="h-4 w-4 mr-1" /> Save
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setShowCreateCustomer(false); setNewCustomerName(""); }}
                    data-testid="button-cancel-new-customer"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search customers..."
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        className="pl-9"
                        data-testid="input-search-customers"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowCreateCustomer(true)}
                      data-testid="button-create-customer"
                    >
                      <Plus className="h-4 w-4 mr-1" /> New
                    </Button>
                  </div>
                  <div className="max-h-32 overflow-y-auto border rounded-md">
                    {filteredCustomers.length === 0 ? (
                      <div className="text-center text-muted-foreground text-sm py-3">No customers found</div>
                    ) : (
                      filteredCustomers.map((c) => (
                        <div
                          key={c.id}
                          className={`px-3 py-2 cursor-pointer text-sm hover-elevate ${selectedCustomerId === String(c.id) ? "bg-primary/10 font-medium" : ""}`}
                          onClick={() => setSelectedCustomerId(String(c.id))}
                          data-testid={`row-customer-${c.id}`}
                        >
                          {c.legalName}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">
                Items ({selectedItems.length} selected, {totalSelectedBales} bales)
              </label>
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Article</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right w-[100px]">Qty</TableHead>
                      <TableHead className="text-right w-[120px]">Price/Bale</TableHead>
                      <TableHead className="text-right w-[120px]">Total</TableHead>
                      <TableHead className="w-[40px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedItems.map((item) => {
                      const lineTotal = item.selectedQty * parseFloat(item.pricePerBale || "0");
                      return (
                        <TableRow key={item.productId} data-testid={`row-finalize-item-${item.productId}`}>
                          <TableCell className="font-mono text-xs">{item.articleCode}</TableCell>
                          <TableCell className="text-sm">{item.productName}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              value={item.selectedQty}
                              onChange={(e) => updateFinalizeQty(item.productId, e.target.value)}
                              className="w-[80px] text-right ml-auto"
                              min={1}
                              max={item.availableBales}
                              data-testid={`input-finalize-qty-${item.productId}`}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              value={item.pricePerBale}
                              onChange={(e) => updateFinalizePrice(item.productId, e.target.value)}
                              className="w-[100px] text-right ml-auto"
                              step="0.01"
                              data-testid={`input-finalize-price-${item.productId}`}
                            />
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatAmount(lineTotal)}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeFromFinalize(item.productId)}
                              data-testid={`button-remove-finalize-${item.productId}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-muted/50 font-bold">
                      <TableCell colSpan={2}>Grand Total</TableCell>
                      <TableCell className="text-right font-mono">{totalSelectedBales}</TableCell>
                      <TableCell></TableCell>
                      <TableCell className="text-right font-mono">{formatAmount(grandTotal)}</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleCloseFinalizeDialog} data-testid="button-cancel-finalize">
                Cancel
              </Button>
              <Button
                onClick={handleSaveProforma}
                disabled={!selectedCustomerId || !proformaName.trim() || selectedItems.length === 0 || bulkCreateMutation.isPending || replaceLinesMutation.isPending}
                data-testid="button-save-proforma"
              >
                <FileText className="h-4 w-4 mr-1" />
                {(bulkCreateMutation.isPending || replaceLinesMutation.isPending) ? "Saving..." : editingProformaId ? "Update Proforma" : "Save Proforma"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-center py-4">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 mb-3">
                <Check className="h-6 w-6 text-green-600 dark:text-green-300" />
              </div>
              <p className="text-sm text-muted-foreground">
                Proforma "{proformaName}" saved with {selectedItems.length} items, {totalSelectedBales} bales.
              </p>
            </div>
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" onClick={handleExportExcel} data-testid="button-export-excel">
                <FileSpreadsheet className="h-4 w-4 mr-1" /> Export Excel
              </Button>
              <Button variant="outline" onClick={handleExportPdf} data-testid="button-export-pdf">
                <Download className="h-4 w-4 mr-1" /> Export PDF
              </Button>
            </div>
            <div className="flex justify-center pt-2">
              <Button onClick={handleCloseFinalizeDialog} data-testid="button-done-proforma">
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );

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
    const totalSellValue = filteredCategories.reduce((s, c) => s + c.totalSellValue, 0);
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
            const gTotalSellCost = sorted.reduce((s, p) => s + p.baleCount * parseFloat(p.sellingPrice || "0"), 0);
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
                        {!hideTotalValue && <div className="text-right"><span className="text-muted-foreground">Cost Value: </span><span className="font-mono font-medium">{formatAmount(prod.totalCost)}</span></div>}
                        {!hideTotalValue && <div className="col-span-2 text-right"><span className="text-muted-foreground">Sell Value: </span><span className="font-mono font-medium text-primary">{formatAmount(prod.baleCount * parseFloat(prod.sellingPrice || "0"))}</span></div>}
                      </div>
                    </Card>
                  ))}
                  <Card className="p-3 bg-muted/50" data-testid="text-search-totals">
                    <div className="flex items-center justify-between gap-2 font-bold text-sm">
                      <span>Total ({sorted.length} items, {gTotalBales.toLocaleString()} bales)</span>
                      <span className="font-mono">{fmt(gTotalKg)} KG</span>
                    </div>
                    {!hideTotalValue && <div className="text-right text-sm font-mono font-bold mt-1">Cost: {formatAmount(gTotalCost)}</div>}
                    {!hideTotalValue && <div className="text-right text-sm font-mono font-bold text-primary">{formatAmount(gTotalSellCost)} sell</div>}
                  </Card>
                </div>

                <div className="hidden md:block rounded-md border overflow-hidden w-full">
                  <table className="w-full table-fixed text-sm">
                    <colgroup>
                      <col style={{ width: "110px" }} />
                      <col style={{ width: "100px" }} />
                      <col />
                      <col style={{ width: "70px" }} />
                      <col style={{ width: "100px" }} />
                      <col style={{ width: "120px" }} />
                      <col style={{ width: "120px" }} />
                    </colgroup>
                    <thead className="bg-muted/50">
                      <tr className="h-12">
                        <th className="text-left px-3 font-medium">Category</th>
                        <th className="text-left px-3 font-medium">Article Code</th>
                        <th className="text-left px-3 font-medium">Bale Name</th>
                        <th className="text-right px-3 font-medium">Bales</th>
                        <th className="text-right px-3 font-medium">Total KG</th>
                        {!hideTotalValue && <th className="text-right px-3 font-medium">Cost/Total Value</th>}
                        {!hideTotalValue && <th className="text-right px-3 font-medium">Sell/Total Value</th>}
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
                          {!hideTotalValue && <td className="text-right px-3 font-mono">{formatAmount(prod.totalCost)}</td>}
                          {!hideTotalValue && <td className="text-right px-3 font-mono text-primary">{formatAmount(prod.baleCount * parseFloat(prod.sellingPrice || "0"))}</td>}
                        </tr>
                      ))}
                      <tr className="border-t bg-muted/50 h-12 font-bold">
                        <td className="px-3" colSpan={3}>Total ({sorted.length} items)</td>
                        <td className="text-right px-3 font-mono">{gTotalBales.toLocaleString()}</td>
                        <td className="text-right px-3 font-mono">{fmt(gTotalKg)}</td>
                        {!hideTotalValue && <td className="text-right px-3 font-mono">{formatAmount(gTotalCost)}</td>}
                        {!hideTotalValue && <td className="text-right px-3 font-mono text-primary">{formatAmount(gTotalSellCost)}</td>}
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
                      {!hideTotalValue && <div className="text-right"><span className="text-muted-foreground">Cost Value: </span><span className="font-mono">{formatAmount(cat.totalCost)}</span></div>}
                      {!hideTotalValue && <div className="col-span-2 text-right"><span className="text-muted-foreground">Sell Value: </span><span className="font-mono text-primary">{formatAmount(cat.totalSellValue)}</span></div>}
                    </div>
                  </Card>
                ))}
                {filteredCategories.length > 0 && (
                  <Card className="p-3 bg-muted/50" data-testid="text-category-totals">
                    <div className="flex items-center justify-between gap-2 font-bold text-sm">
                      <span>Total ({totalProducts} products, {totalBales.toLocaleString()} bales)</span>
                      <span className="font-mono">{fmt(totalKg)} KG</span>
                    </div>
                    {!hideTotalValue && <div className="text-right text-sm font-mono font-bold mt-1">Cost: {formatAmount(totalValue)}</div>}
                    {!hideTotalValue && <div className="text-right text-sm font-mono font-bold text-primary">{formatAmount(totalSellValue)} sell</div>}
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
                    <col style={{ width: "140px" }} />
                  </colgroup>
                  <thead className="bg-muted/50">
                    <tr className="h-12">
                      <th className="text-left px-3 font-medium">Category</th>
                      <th className="text-right px-3 font-medium">Products</th>
                      <th className="text-right px-3 font-medium">Bales</th>
                      <th className="text-right px-3 font-medium">Total KG</th>
                      {!hideTotalValue && <th className="text-right px-3 font-medium">Cost/Total Value</th>}
                      {!hideTotalValue && <th className="text-right px-3 font-medium">Sell/Total Value</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCategories.length === 0 ? (
                      <tr>
                        <td colSpan={hideTotalValue ? 4 : 6} className="text-center py-8 text-muted-foreground">No categories found matching your search</td>
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
                            {!hideTotalValue && <td className="text-right px-3 font-mono">{formatAmount(cat.totalCost)}</td>}
                            {!hideTotalValue && <td className="text-right px-3 font-mono text-primary">{formatAmount(cat.totalSellValue)}</td>}
                          </tr>
                        ))}
                        <tr className="border-t bg-muted/50 h-12 font-bold">
                          <td className="px-3">Total</td>
                          <td className="text-right px-3 font-mono">{totalProducts}</td>
                          <td className="text-right px-3 font-mono">{totalBales.toLocaleString()}</td>
                          <td className="text-right px-3 font-mono">{fmt(totalKg)}</td>
                          {!hideTotalValue && <td className="text-right px-3 font-mono">{formatAmount(totalValue)}</td>}
                          {!hideTotalValue && <td className="text-right px-3 font-mono text-primary">{formatAmount(totalSellValue)}</td>}
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
  const totalSellValue = filteredProducts.reduce((s, p) => s + p.baleCount * parseFloat(p.sellingPrice || "0"), 0);
  const colSpanAll = (isAllItems ? (proformaMode ? 13 : 10) : (proformaMode ? 12 : 9)) - (hideAvgRate ? 2 : 0) - (hideTotalValue ? 2 : 0);
  const colSpanLabel = isAllItems ? (proformaMode ? 4 : 3) : (proformaMode ? 3 : 2);

  return (
    <div className={`p-4 md:p-6 max-w-6xl mx-auto ${proformaMode && selections.size > 0 ? "pb-24" : ""}`}>
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const includeCost = (hideAvgRate && hideTotalValue) ? 0 : 1;
              window.open(`/api/factory/location-inventory/${selectedLocation!.id}/export/excel?includeCost=${includeCost}`, "_blank");
            }}
            data-testid="button-export-inventory-excel"
          >
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Export Excel
          </Button>
          <Button
            variant={proformaMode ? "destructive" : "default"}
            size="sm"
            onClick={toggleProformaMode}
            data-testid="button-toggle-proforma-mode"
          >
            <ClipboardList className="h-4 w-4 mr-1" />
            {proformaMode ? "Exit Proforma Mode" : "Enter Proforma Mode"}
          </Button>
        </div>
      </div>

      {proformaMode && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          {editingProformaId && (
            <div className="w-full flex items-center gap-2 mb-1 p-2 rounded-md bg-primary/10 border border-primary/20">
              <FileText className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-medium text-primary">Editing proforma: <span className="font-bold">{proformaName}</span></span>
              <span className="text-xs text-muted-foreground ml-1">— Select items from inventory and click Update Proforma to save changes</span>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={selectAllVisible} data-testid="button-select-all">
            <Check className="h-4 w-4 mr-1" /> Select All
          </Button>
          <Button variant="outline" size="sm" onClick={deselectAllVisible} data-testid="button-deselect-all">
            <X className="h-4 w-4 mr-1" /> Deselect All
          </Button>
          <div className="flex items-center gap-1.5 ml-2">
            <Checkbox
              checked={showSelectedOnly}
              onCheckedChange={(v) => setShowSelectedOnly(!!v)}
              id="show-selected-only"
              data-testid="checkbox-show-selected-only"
            />
            <label htmlFor="show-selected-only" className="text-sm cursor-pointer select-none">
              Selected only
            </label>
          </div>
          {selections.size > 0 && (
            <Badge variant="secondary" className="text-sm ml-auto">
              {selections.size} items, {Array.from(selections.values()).reduce((s, v) => s + v.selectedQty, 0)} bales
            </Badge>
          )}
        </div>
      )}

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
                const avgRate = (prod as any).productionPrice || 0;
                const weightPerBale = prod.baleCount > 0 ? prod.totalWeight / prod.baleCount : 0;
                const isSelected = selections.has(prod.productId);
                const selection = selections.get(prod.productId);
                return (
                  <Card key={prod.productId} className={`p-3 ${proformaMode && isSelected ? "ring-2 ring-primary" : ""}`} data-testid={`row-product-${prod.productId}`}>
                    <div className="flex items-center gap-2 mb-2">
                      {proformaMode && (
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelection(prod)}
                          data-testid={`checkbox-product-mobile-${prod.productId}`}
                        />
                      )}
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <button
                        onClick={() => !proformaMode && navigate(`/factory/bale-product-history/${prod.productId}/${selectedLocation!.id}`)}
                        className={`text-left font-medium ${proformaMode ? "" : "text-primary hover:underline cursor-pointer"}`}
                        data-testid={`link-product-mobile-${prod.productId}`}
                      >
                        {prod.productName}
                      </button>
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
                      {!hideAvgRate && <div><span className="text-muted-foreground">Cost/Bale: </span><span className="font-mono">{formatAmount(avgRate)}</span></div>}
                      {!hideAvgRate && <div className="text-right"><span className="text-muted-foreground">Sell Price: </span><span className="font-mono text-primary">{formatAmount(parseFloat(prod.sellingPrice || "0"))}</span></div>}
                      {!hideTotalValue && <div className="text-right"><span className="text-muted-foreground">Cost Value: </span><span className="font-mono font-medium">{formatAmount(prod.totalCost)}</span></div>}
                      {!hideTotalValue && <div className="col-span-2 text-right"><span className="text-muted-foreground">Sell Value: </span><span className="font-mono font-medium text-primary">{formatAmount(prod.baleCount * parseFloat(prod.sellingPrice || "0"))}</span></div>}
                    </div>
                    {proformaMode && isSelected && selection && (
                      <div className="mt-2 pt-2 border-t flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground">Qty:</span>
                        <Input
                          type="number"
                          value={selection.selectedQty}
                          onChange={(e) => updateSelectionQty(prod.productId, e.target.value)}
                          className="w-20 text-right"
                          min={1}
                          max={prod.baleCount}
                          data-testid={`input-qty-mobile-${prod.productId}`}
                        />
                        <span className="text-xs text-muted-foreground">/ {prod.baleCount}</span>
                        <span className="text-xs text-muted-foreground ml-2">Price:</span>
                        <Input
                          type="number"
                          value={selection.pricePerBale}
                          onChange={(e) => updateSelectionPrice(prod.productId, e.target.value)}
                          className="w-24 text-right"
                          step="0.01"
                          data-testid={`input-price-mobile-${prod.productId}`}
                        />
                      </div>
                    )}
                  </Card>
                );
              })}
              <Card className="p-3 bg-muted/50" data-testid="text-product-totals">
                <div className="flex items-center justify-between gap-2 font-bold text-sm">
                  <span>Total ({filteredProducts.length} products, {totalBales.toLocaleString()} bales)</span>
                  <span className="font-mono">{fmt(totalKg)} KG</span>
                </div>
                {!hideTotalValue && <div className="text-right text-sm font-mono font-bold mt-1">Cost: {formatAmount(totalCost)}</div>}
              {!hideTotalValue && <div className="text-right text-sm font-mono font-bold text-primary">{formatAmount(totalSellValue)} sell</div>}
              </Card>
            </>
          )}
        </div>

        <div className="hidden md:block rounded-md border overflow-hidden w-full">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              {proformaMode && <col style={{ width: "36px" }} />}
              {isAllItems && <col style={{ width: "110px" }} />}
              <col style={{ width: "100px" }} />
              <col />
              <col style={{ width: "70px" }} />
              {proformaMode && <col style={{ width: "80px" }} />}
              {proformaMode && <col style={{ width: "100px" }} />}
              <col style={{ width: "90px" }} />
              <col style={{ width: "90px" }} />
              <col style={{ width: "100px" }} />
              <col style={{ width: "110px" }} />
              <col style={{ width: "100px" }} />
            </colgroup>
            <thead className="bg-muted/50">
              <tr className="h-12">
                {proformaMode && <th className="px-2"></th>}
                {isAllItems && <th className="text-left px-3 font-medium">Category</th>}
                <th className="text-left px-3 font-medium">Article Code</th>
                <th className="text-left px-3 font-medium">Bale Name</th>
                <th className="text-right px-3 font-medium">Bales</th>
                {proformaMode && <th className="text-right px-3 font-medium">Qty</th>}
                {proformaMode && <th className="text-right px-3 font-medium">Price/Bale</th>}
                <th className="text-right px-3 font-medium">Wt/Bale (KG)</th>
                {!hideAvgRate && <th className="text-right px-3 font-medium">Cost/Bale</th>}
                {!hideAvgRate && <th className="text-right px-3 font-medium">Sell Price</th>}
                {!hideTotalValue && <th className="text-right px-3 font-medium">Cost/Total Value</th>}
                {!hideTotalValue && <th className="text-right px-3 font-medium">Sell/Total Value</th>}
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
                    const avgRate = (prod as any).productionPrice || 0;
                    const weightPerBale = prod.baleCount > 0 ? prod.totalWeight / prod.baleCount : 0;
                    const isSelected = selections.has(prod.productId);
                    const selection = selections.get(prod.productId);
                    return (
                      <tr key={prod.productId} className={`border-t h-12 ${proformaMode && isSelected ? "bg-primary/5" : ""}`} data-testid={`row-product-${prod.productId}`}>
                        {proformaMode && (
                          <td className="px-2 text-center">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelection(prod)}
                              data-testid={`checkbox-product-${prod.productId}`}
                            />
                          </td>
                        )}
                        {isAllItems && <td className="px-3 text-muted-foreground text-xs">{prod.category || "Uncategorized"}</td>}
                        <td className="px-3 text-muted-foreground font-mono text-xs">{prod.articleCode}</td>
                        <td className="px-3 font-medium">
                          <button
                            onClick={() => !proformaMode && navigate(`/factory/bale-product-history/${prod.productId}/${selectedLocation!.id}`)}
                            className={`text-left ${proformaMode ? "" : "text-primary hover:underline cursor-pointer"}`}
                            data-testid={`link-product-desktop-${prod.productId}`}
                          >
                            {prod.productName}
                          </button>
                        </td>
                        <td className="text-right px-3 font-mono">{prod.baleCount.toLocaleString()}</td>
                        {proformaMode && (
                          <td className="text-right px-3">
                            {isSelected && selection ? (
                              <Input
                                type="number"
                                value={selection.selectedQty}
                                onChange={(e) => updateSelectionQty(prod.productId, e.target.value)}
                                className="w-[70px] text-right ml-auto"
                                min={1}
                                max={prod.baleCount}
                                data-testid={`input-qty-${prod.productId}`}
                              />
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        )}
                        {proformaMode && (
                          <td className="text-right px-3">
                            {isSelected && selection ? (
                              <Input
                                type="number"
                                value={selection.pricePerBale}
                                onChange={(e) => updateSelectionPrice(prod.productId, e.target.value)}
                                className="w-[90px] text-right ml-auto"
                                step="0.01"
                                data-testid={`input-price-${prod.productId}`}
                              />
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        )}
                        <td className="text-right px-3 font-mono">{fmt(weightPerBale)}</td>
                        {!hideAvgRate && <td className="text-right px-3 font-mono">{formatAmount(avgRate)}</td>}
                        {!hideAvgRate && <td className="text-right px-3 font-mono text-primary">{formatAmount(parseFloat(prod.sellingPrice || "0"))}</td>}
                        {!hideTotalValue && <td className="text-right px-3 font-mono">{formatAmount(prod.totalCost)}</td>}
                        {!hideTotalValue && <td className="text-right px-3 font-mono text-primary">{formatAmount(prod.baleCount * parseFloat(prod.sellingPrice || "0"))}</td>}
                        <td className="text-right px-3 font-mono">{fmt(prod.totalWeight)}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t bg-muted/50 h-12 font-bold">
                    {proformaMode && <td></td>}
                    <td className="px-3" colSpan={colSpanLabel}>Total ({filteredProducts.length} products)</td>
                    <td className="text-right px-3 font-mono">{totalBales.toLocaleString()}</td>
                    {proformaMode && <td></td>}
                    {proformaMode && <td></td>}
                    <td className="text-right px-3 font-mono"></td>
                    {!hideAvgRate && <td className="text-right px-3 font-mono"></td>}
                    {!hideAvgRate && <td className="text-right px-3 font-mono"></td>}
                    {!hideTotalValue && <td className="text-right px-3 font-mono">{formatAmount(totalCost)}</td>}
                    {!hideTotalValue && <td className="text-right px-3 font-mono text-primary">{formatAmount(totalSellValue)}</td>}
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

      {proformaMode && selections.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 py-3 shadow-lg">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="secondary" className="text-sm">
                {selections.size} items
              </Badge>
              <span className="text-sm font-mono font-medium">
                {totalSelectedBales} bales
              </span>
              <span className="text-sm font-mono text-muted-foreground">
                {formatAmount(grandTotal)} total
              </span>
            </div>
            <Button
              onClick={editingProformaId ? handleSaveProforma : handleFinalize}
              disabled={(bulkCreateMutation.isPending || replaceLinesMutation.isPending) && !!editingProformaId}
              data-testid="button-finalize-proforma-bar"
            >
              <FileText className="h-4 w-4 mr-1" />
              {editingProformaId ? "Update Proforma" : "Finalize Proforma"}
            </Button>
          </div>
        </div>
      )}

      {renderFinalizeDialog()}
    </div>
  );
}
