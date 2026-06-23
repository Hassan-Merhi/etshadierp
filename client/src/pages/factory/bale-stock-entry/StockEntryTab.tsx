import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, AlertCircle, CheckCircle, Loader2, Package, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { useCompany } from "@/contexts/CompanyContext";
import { useFormDraft } from "@/hooks/useFormDraft";
import { DraftRestorePrompt } from "@/components/DraftRestorePrompt";
import { isZebraMode } from "@/lib/zebraPrint";
import { getPaperFormat } from "@/components/LabelPrintSettings";
import { useLabelDesignColors } from "@/hooks/useLabelDesignColors";
import { generateCombinedLabelsHtml, generateA5LabelsHtml, type LabelData, type A4DesignColor } from "@/lib/labelHtml";
import type { FactoryBaleProduct, Location, FactoryCategory } from "@shared/schema";

import { StockEntryCart } from "./StockEntryCart";
import {
  ConfirmStockEntryDialog,
  QuickCreateProductDialog,
  DesignPickerDialog,
  AdminAuthDialog,
} from "./StockEntryDialogs";
import { StockEntryScanner } from "./StockEntryScanner";
import { StockEntrySidebar } from "./StockEntrySidebar";
import { openBrowserPrint, printLabels } from "./StockEntryPrinting";

interface CartItem {
  productId: number;
  product: FactoryBaleProduct;
  qty: number;
  weightPerBaleKg: number;
  finalizedBy: number | null;
  overrideLogoId: number | null;
}

export function StockEntryTab() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [scanInput, setScanInput] = useState("");
  const [scanError, setScanError] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [entryDate, setEntryDate] = useState<string>(new Date().toLocaleDateString("en-CA"));
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("none");
  const [selectedLogoId, setSelectedLogoId] = useState<number | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const { selectedCompany } = useCompany();
  const { colors: designColors } = useLabelDesignColors();

  const {
    hasDraft: hasCartDraft,
    draftAge: cartDraftAge,
    draft: cartDraft,
    scheduleSave: scheduleCartSave,
    discardDraft: discardCartDraft,
  } = useFormDraft({
    entityType: "factory-stock-entry-cart",
    mode: "factory",
    companyId: selectedCompany?.id ?? null,
  });

  useEffect(() => {
    if (cart.length > 0 || selectedLocationId) {
      scheduleCartSave({
        cart: cart.map((i) => ({
          productId: i.productId,
          productName: i.product.name,
          qty: i.qty,
          weightPerBaleKg: i.weightPerBaleKg,
        })),
        selectedLocationId,
      });
    }
  }, [cart, selectedLocationId]);

  const { data: baleProducts, isLoading: productsLoading } = useQuery<FactoryBaleProduct[]>({
    queryKey: ["/api/factory/bale-products"],
  });
  const { data: currentUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const { data: locations } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const { data: categories } = useQuery<FactoryCategory[]>({ queryKey: ["/api/factory/categories"] });

  const { data: workers = [] } = useQuery<any[]>({
    queryKey: ["/api/factory/workers"],
    enabled: cart.length > 0,
  });
  const { data: workerCategoryGroups = [] } = useQuery<any[]>({
    queryKey: ["/api/factory/worker-categories"],
    queryFn: () => fetch("/api/factory/worker-categories", { credentials: "include" }).then((r) => r.json()),
    enabled: cart.length > 0,
  });
  const { data: allCustomers = [] } = useQuery<any[]>({
    queryKey: ["/api/factory/customers"],
    queryFn: () => fetch("/api/factory/customers", { credentials: "include" }).then((r) => r.json()),
  });

  const [workerCategoryFilter, setWorkerCategoryFilter] = useState("all");
  const [workerCategoryFilterManual, setWorkerCategoryFilterManual] = useState(false);

  useEffect(() => {
    if (workerCategoryGroups.length > 0 && !workerCategoryFilterManual) {
      const pressing = workerCategoryGroups.find((c: any) => (c.name as string)?.toLowerCase().includes("pressing"));
      if (pressing) {
        setWorkerCategoryFilter(String(pressing.id));
      }
    }
  }, [workerCategoryGroups, workerCategoryFilterManual]);

  const filteredWorkers =
    workerCategoryFilter === "all"
      ? (workers as any[]).filter((w: any) => w.active !== false)
      : (() => {
          const cat = workerCategoryGroups.find((c: any) => String(c.id) === workerCategoryFilter);
          if (!cat) return (workers as any[]).filter((w: any) => w.active !== false);
          const ids = Array.isArray(cat.workerIds) ? (cat.workerIds as number[]) : [];
          return (workers as any[]).filter((w: any) => w.active !== false && ids.includes(w.id));
        })();

  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickCreateName, setQuickCreateName] = useState("");
  const [quickCreateCategoryId, setQuickCreateCategoryId] = useState("");
  const [quickCreateWeight, setQuickCreateWeight] = useState("");
  const [quickCreateGrade, setQuickCreateGrade] = useState("");
  const [adminAuthOpen, setAdminAuthOpen] = useState(false);
  const [pendingAdminAuth, setPendingAdminAuth] = useState<{ username: string; password: string } | null>(null);
  const [pendingCreateName, setPendingCreateName] = useState("");

  const activeCategories = (categories || []).filter((c) => c.isActive);

  const quickCreateMutation = useMutation({
    mutationFn: async () => {
      const body: any = { name: quickCreateName };
      if (quickCreateCategoryId) body.categoryId = parseInt(quickCreateCategoryId);
      if (quickCreateWeight) body.weightPerBaleKg = quickCreateWeight;
      if (quickCreateGrade) body.grade = quickCreateGrade;
      if (pendingAdminAuth) body.adminAuth = pendingAdminAuth;
      const response = await modeApiRequest("POST", "/api/factory/bale-products", body);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to create product");
      }
      return await response.json();
    },
    onSuccess: (newProduct: FactoryBaleProduct) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });
      toast({
        title: "Product Created",
        description: `"${newProduct.name}" created with article code ${newProduct.articleCode}`,
      });
      setQuickCreateOpen(false);
      setQuickCreateName("");
      setQuickCreateCategoryId("");
      setQuickCreateWeight("");
      setQuickCreateGrade("");
      setPendingAdminAuth(null);
      setPendingCreateName("");
      setScanInput("");
      setShowDropdown(false);
      const defaultWeight = newProduct.weightPerBaleKg ? parseFloat(newProduct.weightPerBaleKg) : 25;
      setCart((prev) => [
        ...prev,
        {
          productId: newProduct.id,
          product: newProduct,
          qty: 1,
          weightPerBaleKg: defaultWeight,
          finalizedBy: null,
          overrideLogoId: null,
        },
      ]);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const activeProducts = (baleProducts || []).filter((p) => p.active);
  const activeLocations = (locations || []).filter((l) => l.active);

  useEffect(() => {
    if (activeLocations && activeLocations.length === 1 && !selectedLocationId) {
      setSelectedLocationId(activeLocations[0].id.toString());
    }
  }, [activeLocations, selectedLocationId]);

  useEffect(() => {
    const active = document.activeElement;
    const isOtherInputFocused =
      active &&
      active !== scanRef.current &&
      (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT");
    if (scanRef.current && !isOtherInputFocused) scanRef.current.focus();
  }, [cart]);

  const handleScan = (value: string) => {
    if (!value.trim()) return;
    setScanError("");

    const trimmed = value.trim().toLowerCase();
    const product = activeProducts?.find(
      (p) => p.articleCode?.toLowerCase() === trimmed || p.code.toLowerCase() === trimmed
    );

    if (!product) {
      setScanError(`Unknown product: "${value}"`);
      setScanInput("");
      return;
    }

    const defaultWeight = product.weightPerBaleKg ? parseFloat(product.weightPerBaleKg) : 25;

    setCart((prev) => {
      const existing = prev.find((item) => item.productId === product.id);
      if (existing) {
        return prev.map((item) => (item.productId === product.id ? { ...item, qty: item.qty + 1 } : item));
      }
      return [
        ...prev,
        {
          productId: product.id,
          product,
          qty: 1,
          weightPerBaleKg: defaultWeight,
          finalizedBy: null,
          overrideLogoId: null,
        },
      ];
    });

    setScanInput("");
  };

  const handleScanKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleScan(scanInput);
    }
  };

  const filteredProducts =
    scanInput.trim().length > 0
      ? (activeProducts || [])
          .filter((p) => {
            const term = scanInput.trim().toLowerCase();
            return (
              p.name.toLowerCase().includes(term) ||
              p.articleCode?.toLowerCase().includes(term) ||
              p.code.toLowerCase().includes(term)
            );
          })
          .slice(0, 1000)
      : [];

  const selectProduct = (product: FactoryBaleProduct) => {
    const defaultWeight = product.weightPerBaleKg ? parseFloat(product.weightPerBaleKg) : 25;
    setCart((prev) => {
      const existing = prev.find((item) => item.productId === product.id);
      if (existing) {
        return prev.map((item) => (item.productId === product.id ? { ...item, qty: item.qty + 1 } : item));
      }
      return [
        ...prev,
        {
          productId: product.id,
          product,
          qty: 1,
          weightPerBaleKg: defaultWeight,
          finalizedBy: null,
          overrideLogoId: null,
        },
      ];
    });
    setScanInput("");
    setScanError("");
    setShowDropdown(false);
  };

  const updateQty = (productId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => (item.productId === productId ? { ...item, qty: Math.max(0, item.qty + delta) } : item))
        .filter((item) => item.qty > 0)
    );
  };

  const setQty = (productId: number, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((item) => item.productId !== productId));
    } else {
      setCart((prev) => prev.map((item) => (item.productId === productId ? { ...item, qty } : item)));
    }
  };

  const updateWeight = (productId: number, weight: number) => {
    setCart((prev) => prev.map((item) => (item.productId === productId ? { ...item, weightPerBaleKg: weight } : item)));
  };

  const removeItem = (productId: number) => {
    setCart((prev) => prev.filter((item) => item.productId !== productId));
  };

  const assignWorker = (productId: number, workerId: number | null) => {
    setCart((prev) => prev.map((item) => (item.productId === productId ? { ...item, finalizedBy: workerId } : item)));
  };

  const setLogoOverride = (productId: number, logoId: number | null) => {
    setCart((prev) => prev.map((item) => (item.productId === productId ? { ...item, overrideLogoId: logoId } : item)));
  };

  const [logoPickerOpen, setLogoPickerOpen] = useState<number | null>(null);

  const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
  const totalKg = cart.reduce((sum, item) => sum + item.qty * item.weightPerBaleKg, 0);

  const handleConfirmClick = () => {
    if (!selectedLocationId) {
      toast({ title: "Error", description: "Please select a warehouse location", variant: "destructive" });
      return;
    }
    if (cart.length === 0) {
      toast({ title: "Error", description: "Please add items to the cart", variant: "destructive" });
      return;
    }
    setConfirmDialogOpen(true);
  };

  const [designPickerOpen, setDesignPickerOpen] = useState(false);
  const [pendingPrintLabels, setPendingPrintLabels] = useState<LabelData[] | null>(null);
  const preOpenedWindowsRef = useRef<{ a4: Window | null; sticker: Window | null } | null>(null);

  const stockEntryMutation = useMutation({
    mutationFn: async () => {
      const response = await modeApiRequest("POST", "/api/factory/stock-entry", {
        erpLocationId: parseInt(selectedLocationId),
        items: cart.map((item) => ({
          productId: item.productId,
          qty: item.qty,
          weightPerBaleKg: item.weightPerBaleKg,
          finalizedBy: item.finalizedBy,
        })),
        entryDate,
        customerId: selectedCustomerId !== "none" ? parseInt(selectedCustomerId) : null,
        logoId: selectedLogoId,
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to record stock entry");
      }
      return await response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/stock-entry/in-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales/daily-summary"] });
      toast({ title: "Stock Entry Recorded", description: `${totalQty} bale(s) added to inventory.` });
      printLabels(data.bales, cart, baleProducts, selectedLogoId, modeApiRequest, toast, preOpenedWindowsRef);
      setCart([]);
      setConfirmDialogOpen(false);
      discardCartDraft();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      <div className="xl:col-span-8 space-y-4">
        <Card className="border-none shadow-none bg-transparent">
          <CardHeader className="px-0 pt-0 pb-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10 text-primary">
                  <Package className="h-4 w-4" />
                </div>
                <CardTitle className="text-base font-bold">New Production Entry</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs font-semibold gap-1.5"
                  onClick={() => {
                    setAdminAuthOpen(true);
                    setPendingCreateName("");
                  }}
                  data-testid="button-quick-create"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Quick Create Product
                </Button>
                {hasCartDraft && (
                  <DraftRestorePrompt
                    age={cartDraftAge}
                    onRestore={() => {
                      if (cartDraft?.cart) {
                        const restored = cartDraft.cart
                          .map((i: any) => {
                            const p = baleProducts?.find((bp) => bp.id === i.productId);
                            return { ...i, product: p };
                          })
                          .filter((i: any) => i.product);
                        setCart(restored);
                      }
                      if (cartDraft?.selectedLocationId) setSelectedLocationId(cartDraft.selectedLocationId);
                      discardCartDraft();
                    }}
                    onDiscard={discardCartDraft}
                  />
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-0 space-y-4">
            <StockEntryScanner
              scanRef={scanRef}
              scanInput={scanInput}
              onScanInputChange={(val) => {
                setScanInput(val);
                setShowDropdown(true);
              }}
              onScanKeyDown={handleScanKeyDown}
              scanError={scanError}
              showDropdown={showDropdown}
              filteredProducts={filteredProducts}
              onSelectProduct={selectProduct}
            />

            <StockEntryCart
              cart={cart}
              workers={workers}
              workerCategoryFilter={workerCategoryFilter}
              onUpdateQty={updateQty}
              onSetQty={setQty}
              onUpdateWeight={updateWeight}
              onRemoveItem={removeItem}
              onAssignWorker={assignWorker}
              onSetLogoOverride={setLogoOverride}
              allCustomers={allCustomers}
              logoPickerOpen={logoPickerOpen}
              onLogoPickerOpenChange={setLogoPickerOpen}
              filteredWorkers={filteredWorkers}
            />
          </CardContent>
        </Card>
      </div>

      <div className="xl:col-span-4 space-y-6">
        <StockEntrySidebar
          selectedLocationId={selectedLocationId}
          onLocationChange={setSelectedLocationId}
          activeLocations={activeLocations || []}
          entryDate={entryDate}
          onEntryDateChange={setEntryDate}
          workerCategoryFilter={workerCategoryFilter}
          onWorkerCategoryFilterChange={(val) => {
            setWorkerCategoryFilter(val);
            setWorkerCategoryFilterManual(true);
          }}
          workerCategoryGroups={workerCategoryGroups}
          selectedCustomerId={selectedCustomerId}
          onCustomerIdChange={setSelectedCustomerId}
          allCustomers={allCustomers}
          totalQty={totalQty}
          totalKg={totalKg}
          isPending={stockEntryMutation.isPending}
          onConfirm={handleConfirmClick}
        />
      </div>

      <ConfirmStockEntryDialog
        open={confirmDialogOpen}
        onOpenChange={setConfirmDialogOpen}
        cart={cart}
        entryDate={entryDate}
        totalQty={totalQty}
        totalKg={totalKg}
        selectedLogoId={selectedLogoId}
        isPending={stockEntryMutation.isPending}
        onConfirm={() => {
          preOpenedWindowsRef.current = {
            a4: window.open("", "_blank"),
            sticker: window.open("", "_blank"),
          };
          stockEntryMutation.mutate();
        }}
      />

      <QuickCreateProductDialog
        open={quickCreateOpen}
        onOpenChange={setQuickCreateOpen}
        grade={quickCreateGrade}
        onGradeChange={setQuickCreateGrade}
        name={quickCreateName}
        onNameChange={setQuickCreateName}
        categoryId={quickCreateCategoryId}
        onCategoryChange={setQuickCreateCategoryId}
        weight={quickCreateWeight}
        onWeightChange={setQuickCreateWeight}
        activeCategories={activeCategories}
        isPending={quickCreateMutation.isPending}
        onSubmit={() => quickCreateMutation.mutate()}
      />

      <AdminAuthDialog
        open={adminAuthOpen}
        onOpenChange={(open) => {
          setAdminAuthOpen(open);
          if (!open) setPendingCreateName("");
        }}
        action="create a new bale product"
        onAuthorized={(credentials) => {
          setPendingAdminAuth(credentials);
          setAdminAuthOpen(false);
          setQuickCreateName(pendingCreateName);
          setQuickCreateOpen(true);
        }}
      />

      <DesignPickerDialog
        open={designPickerOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDesignPickerOpen(false);
            setPendingPrintLabels(null);
          }
        }}
        designColors={designColors}
        onSelect={(color) => {
          setDesignPickerOpen(false);
          if (pendingPrintLabels) {
            const labels = pendingPrintLabels;
            setPendingPrintLabels(null);
            openBrowserPrint(labels, color, preOpenedWindowsRef);
          }
        }}
        onNoDesign={() => {
          setDesignPickerOpen(false);
          if (pendingPrintLabels) {
            const labels = pendingPrintLabels;
            setPendingPrintLabels(null);
            const paperFormat = getPaperFormat();
            const labelHtml = paperFormat === "A5" ? generateA5LabelsHtml(labels) : generateCombinedLabelsHtml(labels);
            const win = window.open("", "_blank");
            if (win) {
              win.document.write(labelHtml);
              win.document.close();
              win.focus();
              setTimeout(() => win.print(), 500);
            }
          }
        }}
      />
    </div>
  );
}
