  import { useState, useRef, useEffect } from "react";
  import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
  import {
    Plus, Minus, Trash2, Printer, ScanLine, AlertCircle, Package, CheckCircle,
    XCircle, ShieldAlert, Lock, Upload, FileSpreadsheet, CalendarDays, List, LayoutList, Download, Palette, Square, Loader2, MessageCircle, ImagePlus,
    Pencil, Layers, Tag, MapPin, Weight, Factory,
  } from "lucide-react";
  import { Button } from "@/components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
  import { Badge } from "@/components/ui/badge";
  import { Input } from "@/components/ui/input";
  import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  } from "@/components/ui/select";
  import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  } from "@/components/ui/table";
  import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
  } from "@/components/ui/dialog";
  import {
    Popover, PopoverContent, PopoverTrigger,
  } from "@/components/ui/popover";
  import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
  } from "@/components/ui/dropdown-menu";
  import { ChevronDown } from "lucide-react";
  import { Skeleton } from "@/components/ui/skeleton";
  import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
  import { useToast } from "@/hooks/use-toast";
  import { queryClient } from "@/lib/queryClient";
  import { useAppMode } from "@/contexts/AppModeContext";
  import { getApiRequest } from "@/lib/factoryApi";
  import { apiRequest } from "@/lib/queryClient";
  import { useCompany } from "@/contexts/CompanyContext";
  import { useFormDraft } from "@/hooks/useFormDraft";
  import { DraftRestorePrompt } from "@/components/DraftRestorePrompt";
  import { formatNumber } from "@/lib/formatNumber";
  import { useDateFormat } from "@/contexts/DateFormatContext";
  import { isZebraMode, printRawZpl } from "@/lib/zebraPrint";
  import { buildZplBatch } from "@/lib/zplBuilder";
  import { LabelPrintSettings, getPaperFormat } from "@/components/LabelPrintSettings";
  import { Label } from "@/components/ui/label";
  import { Checkbox } from "@/components/ui/checkbox";
  import * as XLSX from "@/lib/excelHelper";
  import StockEntryHistory from "../StockEntryHistory";
import GroundScan from "./GroundScan";
import DailyScan from "./DailyScan";
  import { AdminAuthDialog } from "@/components/AdminAuthDialog";
  import type { FactoryBaleProduct, Location, FactoryCategory } from "@shared/schema";
  import { generateCombinedLabelsHtml, generateA5LabelsHtml, generateStickerLabelsHtml, prefetchBarcodeDataUrls, prefetchLogoDataUrl, prefetchLogoEager, formatLabelNum, type LabelData, type A4DesignColor } from "@/lib/labelHtml";
  import { useLabelDesignColors } from "@/hooks/useLabelDesignColors";
  import { consumeRef } from "@/lib/refPool";
  import { enqueueRequest } from "@/lib/offlineQueue";

  interface CartItem {
    productId: number;
    product: FactoryBaleProduct;
    qty: number;
    weightPerBaleKg: number;
    finalizedBy: number | null;
    overrideLogoId: number | null;
  }

  function BaleLogoPickerPopover({
    productId, overrideLogoId, allCustomers, onSelect, open, onOpenChange,
  }: {
    productId: number;
    overrideLogoId: number | null;
    allCustomers: any[];
    onSelect: (logoId: number | null) => void;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) {
    const [pickerCustomerId, setPickerCustomerId] = useState("none");
    const { data: logos = [] } = useQuery<any[]>({
      queryKey: ["/api/factory/customers", pickerCustomerId, "logos"],
      queryFn: () => fetch(`/api/factory/customers/${pickerCustomerId}/logos`, { credentials: "include" }).then(r => r.json()),
      enabled: pickerCustomerId !== "none",
    });
    const activeCustomers = allCustomers.filter((c: any) => c.active);
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            data-testid={`button-logo-override-${productId}`}
            title={overrideLogoId ? "Custom logo assigned — click to change" : "Assign customer logo for this bale"}
          >
            {overrideLogoId ? (
              <img src={`/api/factory/customer-logos/${overrideLogoId}/image`} alt="Logo" className="h-5 w-8 object-contain rounded" />
            ) : (
              <ImagePlus className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="end">
          <p className="text-xs font-medium text-muted-foreground mb-2">Label logo (this bale only)</p>
          <div className="space-y-2">
            <Select value={pickerCustomerId} onValueChange={setPickerCustomerId}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Choose customer..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Choose customer —</SelectItem>
                {activeCustomers.map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.legalName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {pickerCustomerId !== "none" && (
              logos.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">No logos uploaded for this customer.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {logos.map((logo: any) => (
                    <button
                      key={logo.id}
                      type="button"
                      onClick={() => { onSelect(logo.id); onOpenChange(false); }}
                      className={`flex flex-col items-center gap-0.5 p-1.5 rounded-md border text-xs ${overrideLogoId === logo.id ? "border-primary bg-primary/10" : "border-border hover-elevate"}`}
                      data-testid={`bale-logo-option-${productId}-${logo.id}`}
                    >
                      <img src={`/api/factory/customer-logos/${logo.id}/image`} alt={logo.name} className="h-6 w-10 object-contain" />
                      <span className="truncate max-w-[56px]">{logo.name}</span>
                    </button>
                  ))}
                </div>
              )
            )}
            {overrideLogoId && (
              <button
                className="text-xs text-muted-foreground underline hover:text-foreground mt-1"
                onClick={() => { onSelect(null); onOpenChange(false); }}
                data-testid={`bale-logo-clear-${productId}`}
              >
                Clear logo
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  function StockEntryTab() {
    const [cart, setCart] = useState<CartItem[]>([]);
    const [scanInput, setScanInput] = useState("");
    const [scanError, setScanError] = useState("");
    const [showDropdown, setShowDropdown] = useState(false);
    const [selectedLocationId, setSelectedLocationId] = useState<string>("");
    const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
    const [entryDate, setEntryDate] = useState<string>(new Date().toLocaleDateString('en-CA'));
    const [selectedCustomerId, setSelectedCustomerId] = useState<string>("none");
    const [selectedLogoId, setSelectedLogoId] = useState<number | null>(null);
    const scanRef = useRef<HTMLInputElement>(null);
    const { toast } = useToast();
    const appMode = useAppMode();
    const modeApiRequest = getApiRequest(appMode);
    const { selectedCompany } = useCompany();
    const { colors: designColors } = useLabelDesignColors();

    const { hasDraft: hasCartDraft, draftAge: cartDraftAge, draft: cartDraft, scheduleSave: scheduleCartSave, discardDraft: discardCartDraft } = useFormDraft({
      entityType: "factory-stock-entry-cart",
      mode: "factory",
      companyId: selectedCompany?.id ?? null,
    });

    useEffect(() => {
      if (cart.length > 0 || selectedLocationId) {
        scheduleCartSave({ cart: cart.map(i => ({ productId: i.productId, productName: i.product.name, qty: i.qty, weightPerBaleKg: i.weightPerBaleKg })), selectedLocationId });
      }
    }, [cart, selectedLocationId]);

    const { data: baleProducts, isLoading: productsLoading } = useQuery<FactoryBaleProduct[]>({
      queryKey: ["/api/factory/bale-products"],
    });
    const { data: currentUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
    const isAdmin = ["Admin", "Owner", "Developer"].includes(currentUser?.role || "");
    const { data: locations } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
    const { data: categories } = useQuery<FactoryCategory[]>({ queryKey: ["/api/factory/categories"] });
    // Workers and their category groups are only needed when the user has items in the cart
    // (worker assignment appears per cart item). Deferring avoids loading this large list upfront.
    const { data: workers = [] } = useQuery<any[]>({
      queryKey: ["/api/factory/workers"],
      enabled: cart.length > 0,
    });
    const { data: workerCategoryGroups = [] } = useQuery<any[]>({
      queryKey: ["/api/factory/worker-categories"],
      queryFn: () => fetch("/api/factory/worker-categories", { credentials: "include" }).then(r => r.json()),
      enabled: cart.length > 0,
    });
    const { data: allCustomers = [] } = useQuery<any[]>({
      queryKey: ["/api/factory/customers"],
      queryFn: () => fetch("/api/factory/customers", { credentials: "include" }).then(r => r.json()),
    });
    const { data: customerLogosForPrint = [] } = useQuery<any[]>({
      queryKey: ["/api/factory/customers", selectedCustomerId, "logos"],
      queryFn: () => fetch(`/api/factory/customers/${selectedCustomerId}/logos`, { credentials: "include" }).then(r => r.json()),
      enabled: !!selectedCustomerId && selectedCustomerId !== "none",
    });

    const [workerCategoryFilter, setWorkerCategoryFilter] = useState("all");

    const filteredWorkers = workerCategoryFilter === "all"
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

    const activeCategories = categories?.filter((c) => c.isActive);

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
        toast({ title: "Product Created", description: `"${newProduct.name}" created with article code ${newProduct.articleCode}` });
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
        setCart((prev) => [...prev, { productId: newProduct.id, product: newProduct, qty: 1, weightPerBaleKg: defaultWeight, finalizedBy: null, overrideLogoId: null }]);
      },
      onError: (error: Error) => {
        if (error?._handledGlobally) return;
        toast({ title: "Error", description: error.message, variant: "destructive" });
      },
    });

    const activeProducts = baleProducts?.filter((p) => p.active);
    const activeLocations = locations?.filter((l) => l.active);

    useEffect(() => {
      if (activeLocations && activeLocations.length === 1 && !selectedLocationId) {
        setSelectedLocationId(activeLocations[0].id.toString());
      }
    }, [activeLocations, selectedLocationId]);

    useEffect(() => {
      const active = document.activeElement;
      const isOtherInputFocused = active && active !== scanRef.current && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT");
      if (scanRef.current && !isOtherInputFocused) scanRef.current.focus();
    }, [cart]);

    const handleScan = (value: string) => {
      if (!value.trim()) return;
      setScanError("");

      const trimmed = value.trim().toLowerCase();
      const product = activeProducts?.find(
        (p) =>
          p.articleCode?.toLowerCase() === trimmed ||
          p.code.toLowerCase() === trimmed
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
          return prev.map((item) =>
            item.productId === product.id ? { ...item, qty: item.qty + 1 } : item
          );
        }
        return [...prev, { productId: product.id, product, qty: 1, weightPerBaleKg: defaultWeight, finalizedBy: null, overrideLogoId: null }];
      });

      setScanInput("");
    };

    const handleScanKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleScan(scanInput);
      }
    };

    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const filteredProducts = scanInput.trim().length > 0
      ? (activeProducts || []).filter((p) => {
          const term = scanInput.trim().toLowerCase();
          return (
            p.name.toLowerCase().includes(term) ||
            (p.articleCode?.toLowerCase().includes(term)) ||
            p.code.toLowerCase().includes(term)
          );
        }).slice(0, 1000)
      : [];

    const selectProduct = (product: FactoryBaleProduct) => {
      const defaultWeight = product.weightPerBaleKg ? parseFloat(product.weightPerBaleKg) : 25;
      setCart((prev) => {
        const existing = prev.find((item) => item.productId === product.id);
        if (existing) {
          return prev.map((item) =>
            item.productId === product.id ? { ...item, qty: item.qty + 1 } : item
          );
        }
        return [...prev, { productId: product.id, product, qty: 1, weightPerBaleKg: defaultWeight, finalizedBy: null, overrideLogoId: null }];
      });
      setScanInput("");
      setScanError("");
      setShowDropdown(false);
    };

    const updateQty = (productId: number, delta: number) => {
      setCart((prev) =>
        prev
          .map((item) =>
            item.productId === productId ? { ...item, qty: Math.max(0, item.qty + delta) } : item
          )
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
      setCart((prev) => prev.map((item) => item.productId === productId ? { ...item, finalizedBy: workerId } : item));
    };

    const setLogoOverride = (productId: number, logoId: number | null) => {
      setCart((prev) => prev.map((item) => item.productId === productId ? { ...item, overrideLogoId: logoId } : item));
    };

    const [logoPickerOpen, setLogoPickerOpen] = useState<number | null>(null);

    const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
    const totalKg = cart.reduce((sum, item) => sum + item.qty * item.weightPerBaleKg, 0);

    const selectedLocationName = activeLocations?.find((l) => l.id.toString() === selectedLocationId);

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
    // Pre-opened windows reserved synchronously on button click (before any await),
    // so the browser considers them user-initiated and doesn't block them.
    const preOpenedWindowsRef = useRef<{ a4: Window | null; sticker: Window | null } | null>(null);

    const openBrowserPrint = (labels: LabelData[], designColor?: A4DesignColor) => {
      const paperFormat = getPaperFormat();
      const hasPerLabelColors = labels.some((l) => l.designColor);
      const hasPerLabelLogos = labels.some((l) => l.customerLogoUrl);
      // Labels that have a color or logo go to A4/A5 design window
      const labelsForA4 = designColor ? labels : labels.filter((l) => l.designColor || l.customerLogoUrl);

      // Consume pre-opened windows if available, otherwise fall back to window.open
      const preOpened = preOpenedWindowsRef.current;
      preOpenedWindowsRef.current = null;

      if (paperFormat === "A4" && !designColor && !hasPerLabelColors && !hasPerLabelLogos) {
        // All labels have no color or logo assigned — barcode/sticker only, close unused A4 window
        if (preOpened?.a4 && !preOpened.a4.closed) preOpened.a4.close();
      } else if (labelsForA4.length > 0) {
        const labelHtml = paperFormat === "A5" ? generateA5LabelsHtml(labelsForA4) : generateCombinedLabelsHtml(labelsForA4, designColor);
        const a4Window = (preOpened?.a4 && !preOpened.a4.closed) ? preOpened.a4 : window.open("", "_blank");
        if (a4Window) {
          a4Window.document.write(labelHtml);
          a4Window.document.close();
          a4Window.focus();
          const a4Imgs = a4Window.document.images;
          let a4Loaded = 0;
          const a4Total = a4Imgs.length;
          const tryA4Print = () => { a4Loaded++; if (a4Loaded >= a4Total) setTimeout(() => a4Window.print(), 200); };
          if (a4Total === 0) { setTimeout(() => a4Window.print(), 200); }
          else { for (let i = 0; i < a4Total; i++) { if (a4Imgs[i].complete) tryA4Print(); else a4Imgs[i].onload = a4Imgs[i].onerror = tryA4Print; } }
        }
      } else {
        if (preOpened?.a4 && !preOpened.a4.closed) preOpened.a4.close();
      }

      // Sticker/barcode window always prints all labels regardless of color
      const stickerWindow = (preOpened?.sticker && !preOpened.sticker.closed) ? preOpened.sticker : window.open("", "_blank");
      if (stickerWindow) {
        stickerWindow.document.write(generateStickerLabelsHtml(labels));
        stickerWindow.document.close();
        stickerWindow.focus();
        const imgs = stickerWindow.document.images;
        let loaded = 0;
        const total = imgs.length;
        const tryPrint = () => { loaded++; if (loaded >= total) setTimeout(() => stickerWindow.print(), 300); };
        if (total === 0) { setTimeout(() => stickerWindow.print(), 300); }
        else { for (let i = 0; i < total; i++) { if (imgs[i].complete) tryPrint(); else imgs[i].onload = imgs[i].onerror = tryPrint; } }
      }
      if (!stickerWindow) {
        toast({ title: "Warning", description: "Please allow pop-ups to print labels", variant: "destructive" });
      }
    };

    const printLabels = async (bales: any[]) => {
      try {
        // Fire-and-forget audit record — don't block printing on this insert
        modeApiRequest("POST", "/api/bale-label-prints", {
          bales: bales.map((bale: any) => {
            const cartItem = cart.find((c) => c.productId === bale.productId);
            return {
              productionBaleId: bale.id,
              productId: bale.productId,
              articleCode: bale.articleCode || cartItem?.product.articleCode || cartItem?.product.code || "",
              pieces: 1,
              approxWeightKg: bale.weightKg || "0",
            };
          }),
        }).catch(() => {});

        // Build labels directly from the stock-entry response — no extra round-trip needed
        const labelProductIds: number[] = [];
        const labels: LabelData[] = bales.map((bale: any) => {
          const product = baleProducts?.find((p) => p.id === bale.productId);
          const cartItem = cart.find((c) => c.productId === bale.productId);
          labelProductIds.push(bale.productId ?? 0);
          const hasLogo = cartItem?.overrideLogoId || selectedLogoId;
          const effectiveColor: A4DesignColor | null = hasLogo
            ? null
            : ((product?.labelDesignColor as A4DesignColor | null | undefined) || null);
          return {
            referenceNumber: bale.referenceNumber,
            articleCode: bale.articleCode || cartItem?.product.articleCode || cartItem?.product.code || "",
            pieces: 1,
            approxWeightKg: bale.weightKg || "0",
            productName: bale.productName || "",
            ...(effectiveColor ? { designColor: effectiveColor } : {}),
          };
        });

        // Fetch logos via session cache (instant on reprint, parallel on first use)
        if (!isZebraMode()) {
          const logoIdsNeeded = new Set<number>();
          for (let i = 0; i < labels.length; i++) {
            const cartItem = cart.find((c) => c.productId === labelProductIds[i]);
            const logoId = cartItem?.overrideLogoId ?? selectedLogoId ?? null;
            if (logoId) logoIdsNeeded.add(logoId);
          }
          await Promise.all([...logoIdsNeeded].map(prefetchLogoDataUrl));
          for (let i = 0; i < labels.length; i++) {
            const cartItem = cart.find((c) => c.productId === labelProductIds[i]);
            const logoId = cartItem?.overrideLogoId ?? selectedLogoId ?? null;
            if (logoId) {
              const dataUrl = await prefetchLogoDataUrl(logoId);
              if (dataUrl) {
                labels[i].customerLogoUrl = dataUrl;
                delete labels[i].designColor;
              }
            }
          }
        }

        if (isZebraMode()) {
          try {
            const zpl = buildZplBatch(labels, true);
            await printRawZpl(zpl);
            toast({ title: "Labels sent to Zebra printer" });
          } catch (err: any) {
            toast({ title: "Zebra print failed", description: err.message + " — Falling back to browser print.", variant: "destructive" });
            const prefetchedLabels = await prefetchBarcodeDataUrls(labels);
            openBrowserPrint(prefetchedLabels);
          }
        } else {
          // Pre-fetch all barcode images in parallel before opening the popup so
          // the print window contains fully self-contained HTML (no network requests).
          const prefetchedLabels = await prefetchBarcodeDataUrls(labels);
          openBrowserPrint(prefetchedLabels);
        }
      } catch (error: any) {
        toast({ title: "Label Error", description: error.message || "Failed to generate labels", variant: "destructive" });
      }
    };

    const stockEntryMutation = useMutation({
      mutationFn: async () => {
        const items = cart.map((item) => ({
          productId: item.productId,
          quantity: item.qty,
          weightPerBale: item.weightPerBaleKg.toString(),
          finalizedBy: item.finalizedBy,
        }));

        const body: any = {
          items,
          erpLocationId: parseInt(selectedLocationId),
          entryDate,
        };
        const response = await modeApiRequest("POST", "/api/factory/stock-entry", body);

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.message || "Failed to enter bales into stock");
        }

        return await response.json();
      },
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
        queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
        queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });
        queryClient.invalidateQueries({ queryKey: ["/api/factory/stock-entry/in-stock"] });

        toast({
          title: "Stock Entry Complete",
          description: `${result.bales.length} bale(s) entered into stock. Preparing labels...`,
        });

        discardCartDraft();
        setConfirmDialogOpen(false);
        setCart([]);

        printLabels(result.bales);
      },
      onError: async (error: Error) => {
        if (error?._handledGlobally) return;
        if ((error as any).name === "OfflineQueued") {
          // Offline: use pre-allocated pool refs (scannable) or fall back to OFFL-xxx
          const today = new Date().toLocaleDateString('en-CA').replace(/-/g, "");
          let globalIdx = 0;
          const syntheticLabels: LabelData[] = [];
          const pooledBales: Array<{ referenceNumber: string; articleCode: string; pieces: number; approxWeightKg: string; productId: number }> = [];

          for (const item of cart) {
            for (let i = 0; i < item.qty; i++) {
              globalIdx++;
              const articleCode = item.product?.articleCode || item.product?.code || "";
              const pooledRef = await consumeRef();
              const referenceNumber = pooledRef ?? `OFFL-${today}-${String(globalIdx).padStart(3, "0")}`;

              syntheticLabels.push({
                referenceNumber,
                articleCode,
                pieces: 1,
                approxWeightKg: String(item.weightPerBaleKg),
                productName: item.product?.name ?? "",
              });

              if (pooledRef) {
                pooledBales.push({
                  referenceNumber: pooledRef,
                  articleCode,
                  pieces: 1,
                  approxWeightKg: String(item.weightPerBaleKg),
                  productId: item.productId,
                });
              }
            }
          }

          // Queue the label print records so DB is updated when back online
          if (pooledBales.length > 0) {
            enqueueRequest(
              "/api/bale-label-prints",
              "POST",
              JSON.stringify({ bales: pooledBales }),
              "Label Print"
            );
          }

          discardCartDraft();
          setConfirmDialogOpen(false);
          setCart([]);
          if (syntheticLabels.length > 0) {
            openBrowserPrint(syntheticLabels);
          }
          return;
        }
        // Close any pre-opened windows if the mutation genuinely failed
        if (preOpenedWindowsRef.current) {
          preOpenedWindowsRef.current.a4?.close();
          preOpenedWindowsRef.current.sticker?.close();
          preOpenedWindowsRef.current = null;
        }
        toast({ title: "Error", description: error.message, variant: "destructive" });
      },
    });

    if (productsLoading) {
      return (
        <div className="space-y-6">
          <Skeleton className="h-10 w-64" data-testid="text-loading" />
          <Skeleton className="h-40 w-full" />
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {hasCartDraft && cartDraftAge && (
          <DraftRestorePrompt
            draftAge={cartDraftAge}
            label="Unsaved stock entry cart found"
            onRestore={() => {
              const d = cartDraft?.data as any;
              if (d?.selectedLocationId) setSelectedLocationId(d.selectedLocationId);
              discardCartDraft();
              toast({ title: "Draft restored", description: "Location was restored. Re-add items via scan." });
            }}
            onDiscard={discardCartDraft}
          />
        )}
        {/* Location bar */}
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border bg-muted/30">
          <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">Location</span>
          <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
            <SelectTrigger className="flex-1 border-0 bg-transparent shadow-none h-7 text-sm font-medium focus:ring-0 p-0 pl-1" data-testid="select-stock-entry-location">
              <SelectValue placeholder="Select location…" />
            </SelectTrigger>
            <SelectContent>
              {activeLocations?.map((loc) => (
                <SelectItem key={loc.id} value={loc.id.toString()}>
                  {loc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-6">
          <div className="flex-1 min-w-0 space-y-4">
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="flex items-center gap-2.5 px-4 py-3 border-b bg-muted/20">
                <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-emerald-500/15 border border-emerald-500/20 shrink-0">
                  <ScanLine className="h-3.5 w-3.5 text-emerald-500" />
                </div>
                <span className="text-sm font-semibold">Scan / Add Product</span>
              </div>
              <div className="p-4">
                <div className="space-y-2 relative">
                  <Input
                    ref={scanRef}
                    value={scanInput}
                    onChange={(e) => { setScanInput(e.target.value); setScanError(""); setShowDropdown(true); setHighlightedIndex(0); }}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        if (showDropdown && filteredProducts.length > 0) {
                          setHighlightedIndex((prev) => {
                            const next = prev < filteredProducts.length - 1 ? prev + 1 : 0;
                            const el = dropdownRef.current?.children[next] as HTMLElement;
                            if (el) el.scrollIntoView({ block: "nearest" });
                            return next;
                          });
                        }
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        if (showDropdown && filteredProducts.length > 0) {
                          setHighlightedIndex((prev) => {
                            const next = prev > 0 ? prev - 1 : filteredProducts.length - 1;
                            const el = dropdownRef.current?.children[next] as HTMLElement;
                            if (el) el.scrollIntoView({ block: "nearest" });
                            return next;
                          });
                        }
                      } else if (e.key === "Enter" || e.key === "Tab") {
                        if (showDropdown && filteredProducts.length > 0) {
                          e.preventDefault();
                          const idx = highlightedIndex >= 0 && highlightedIndex < filteredProducts.length ? highlightedIndex : 0;
                          selectProduct(filteredProducts[idx]);
                          setHighlightedIndex(0);
                        } else if (e.key === "Enter") {
                          e.preventDefault();
                          handleScan(scanInput);
                          setHighlightedIndex(0);
                        }
                      } else if (e.key === "Escape") {
                        setShowDropdown(false);
                        setHighlightedIndex(-1);
                      }
                    }}
                    onFocus={() => { if (scanInput.trim()) setShowDropdown(true); }}
                    placeholder="Scan barcode or type name / article code..."
                    autoFocus
                    data-testid="input-stock-entry-scan"
                  />
                  {showDropdown && scanInput.trim().length > 0 && filteredProducts.length > 0 && (
                    <div ref={dropdownRef} className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-y-auto" data-testid="dropdown-product-suggestions">
                      {filteredProducts.map((p, idx) => (
                        <button
                          key={p.id}
                          type="button"
                          className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-sm ${idx === highlightedIndex ? "bg-accent text-accent-foreground" : "hover-elevate"}`}
                          onClick={() => { selectProduct(p); setHighlightedIndex(-1); }}
                          onMouseEnter={() => setHighlightedIndex(idx)}
                          data-testid={`button-select-product-${p.id}`}
                        >
                          <span className="font-medium">{p.name}</span>
                          <span className="text-muted-foreground font-mono text-xs">{p.articleCode || p.code}</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 hover-elevate flex items-center gap-2 text-sm font-medium border-t text-muted-foreground"
                        onClick={() => {
                          const name = scanInput.trim();
                          setShowDropdown(false);
                          if (isAdmin) {
                            setQuickCreateName(name);
                            setQuickCreateOpen(true);
                          } else {
                            setPendingCreateName(name);
                            setAdminAuthOpen(true);
                          }
                        }}
                        data-testid="button-quick-create-product-inline"
                      >
                        <Plus className="h-4 w-4" />
                        Create New Product "{scanInput.trim()}"
                      </button>
                    </div>
                  )}
                  {showDropdown && scanInput.trim().length > 0 && filteredProducts.length === 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg" data-testid="dropdown-no-products">
                      <div className="px-3 py-2 text-sm text-muted-foreground">No products found</div>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 hover-elevate flex items-center gap-2 text-sm font-medium border-t"
                        onClick={() => {
                          const name = scanInput.trim();
                          setShowDropdown(false);
                          if (isAdmin) {
                            setQuickCreateName(name);
                            setQuickCreateOpen(true);
                          } else {
                            setPendingCreateName(name);
                            setAdminAuthOpen(true);
                          }
                        }}
                        data-testid="button-quick-create-product"
                      >
                        <Plus className="h-4 w-4" />
                        Create New Product "{scanInput.trim()}"
                      </button>
                    </div>
                  )}
                  {scanError && (
                    <div className="flex items-center gap-2 text-destructive text-sm" data-testid="text-scan-error">
                      <AlertCircle className="h-4 w-4" />
                      {scanError}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b bg-muted/20 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 shrink-0">
                    <Package className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <span className="text-sm font-semibold">Cart</span>
                  {totalQty > 0 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-primary/15 text-primary border border-primary/20">
                      {totalQty} bales
                    </span>
                  )}
                </div>
                {workerCategoryGroups.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Filter workers by:</span>
                    <Select value={workerCategoryFilter} onValueChange={setWorkerCategoryFilter}>
                      <SelectTrigger className="h-8 w-44 text-xs" data-testid="select-worker-category-filter">
                        <SelectValue placeholder="All workers" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Workers</SelectItem>
                        {workerCategoryGroups.map((c: any) => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div>
                {cart.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p data-testid="text-empty-cart">Scan a product to add it to the cart</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader className="sticky top-0 z-30 bg-background">
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-center w-40">Qty</TableHead>
                        <TableHead className="text-right w-32">Wt/Bale (kg)</TableHead>
                        <TableHead className="text-right w-32">Total (kg)</TableHead>
                        <TableHead className="w-44">Worker</TableHead>
                        <TableHead className="w-10">Logo</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cart.map((item) => (
                        <TableRow key={item.productId} data-testid={`row-cart-${item.productId}`}>
                          <TableCell>
                            <div className="font-medium" data-testid={`text-product-name-${item.productId}`}>{item.product?.name}</div>
                            <div className="text-sm text-muted-foreground font-mono">{item.product?.articleCode || item.product?.code}</div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-center gap-1">
                              <Button variant="outline" size="icon" onClick={() => updateQty(item.productId, -1)} data-testid={`button-qty-minus-${item.productId}`}>
                                <Minus className="h-3 w-3" />
                              </Button>
                              <Input
                                type="number"
                                value={item.qty}
                                onChange={(e) => setQty(item.productId, parseInt(e.target.value) || 0)}
                                className="w-16 text-center"
                                min={1}
                                data-testid={`input-qty-${item.productId}`}
                              />
                              <Button variant="outline" size="icon" onClick={() => updateQty(item.productId, 1)} data-testid={`button-qty-plus-${item.productId}`}>
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              value={item.weightPerBaleKg}
                              onChange={(e) => updateWeight(item.productId, parseFloat(e.target.value) || 0)}
                              className="w-24 text-right ml-auto"
                              step="0.1"
                              min={0}
                              data-testid={`input-weight-${item.productId}`}
                            />
                          </TableCell>
                          <TableCell className="text-right font-medium" data-testid={`text-total-kg-${item.productId}`}>
                            {formatNumber(item.qty * item.weightPerBaleKg)}
                          </TableCell>
                          <TableCell>
                            <Select
                              value={item.finalizedBy !== null ? String(item.finalizedBy) : "unassigned"}
                              onValueChange={(v) => assignWorker(item.productId, v === "unassigned" ? null : parseInt(v))}
                            >
                              <SelectTrigger className="w-40" data-testid={`select-worker-${item.productId}`}>
                                <SelectValue placeholder="Unassigned" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unassigned">Unassigned</SelectItem>
                                {filteredWorkers.map((w: any) => (
                                  <SelectItem key={w.id} value={String(w.id)}>{w.fullName || w.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <BaleLogoPickerPopover
                              productId={item.productId}
                              overrideLogoId={item.overrideLogoId}
                              allCustomers={allCustomers}
                              onSelect={(logoId) => setLogoOverride(item.productId, logoId)}
                              open={logoPickerOpen === item.productId}
                              onOpenChange={(open) => setLogoPickerOpen(open ? item.productId : null)}
                            />
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" onClick={() => removeItem(item.productId)} data-testid={`button-remove-${item.productId}`}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          </div>

          <div className="w-72 space-y-3 sticky top-4 self-start overflow-y-auto max-h-[calc(100vh-8rem)]">
            {/* Summary card */}
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="flex items-center gap-2.5 px-4 py-3 border-b bg-muted/20">
                <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-emerald-500/15 border border-emerald-500/20 shrink-0">
                  <Package className="h-3.5 w-3.5 text-emerald-500" />
                </div>
                <span className="text-sm font-semibold">Entry Summary</span>
              </div>
              <div className="p-4 space-y-4">
                {/* Big stats row */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                    <div className="text-xs text-muted-foreground mb-0.5">Total Bales</div>
                    <div className="text-2xl font-bold tabular-nums leading-tight" data-testid="text-total-bales">{totalQty}</div>
                  </div>
                  <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                    <div className="text-xs text-muted-foreground mb-0.5">Weight</div>
                    <div className="text-lg font-bold tabular-nums leading-tight" data-testid="text-total-weight">{formatNumber(totalKg)}<span className="text-xs font-medium ml-0.5 text-muted-foreground">kg</span></div>
                  </div>
                </div>

                {/* Location */}
                {selectedLocationName && (
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="font-medium truncate">{selectedLocationName.name}</span>
                  </div>
                )}

                {/* Divider */}
                <div className="border-t" />

                {/* Entry date */}
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" />
                    Entry Date
                  </div>
                  <Input
                    type="date"
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value || new Date().toLocaleDateString('en-CA'))}
                    className="w-full text-sm h-8"
                    data-testid="input-entry-date"
                  />
                  {entryDate !== new Date().toLocaleDateString('en-CA') && (
                    <button
                      className="text-xs text-muted-foreground underline mt-1 hover:text-foreground"
                      onClick={() => setEntryDate(new Date().toLocaleDateString('en-CA'))}
                      data-testid="button-reset-entry-date"
                    >
                      Reset to today
                    </button>
                  )}
                </div>
              </div>
            </div>

            <Button
              className="w-full gap-2 bg-emerald-600 hover:bg-emerald-600 text-white h-11 text-sm font-semibold rounded-xl"
              disabled={cart.length === 0 || !selectedLocationId || stockEntryMutation.isPending}
              onClick={handleConfirmClick}
              data-testid="button-confirm-stock-entry"
            >
              {stockEntryMutation.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</>
                : <><CheckCircle className="h-4 w-4" /> Confirm & Print Labels{totalQty > 0 && ` (${totalQty})`}</>
              }
            </Button>
          </div>
        </div>

        <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
          <DialogContent className="max-h-[85vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Confirm Stock Entry</DialogTitle>
              <DialogDescription>
                {totalQty} bale(s) will be entered into stock. Labels ({getPaperFormat()} format) and sticker labels will print for each bale.
              </DialogDescription>
            </DialogHeader>
            <div className="text-sm space-y-3 overflow-y-auto flex-1 pr-1">
              {entryDate !== new Date().toLocaleDateString('en-CA') && (
                <div className="flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-amber-800 dark:text-amber-200 text-xs">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                  <span>Backdated entry — will be recorded on <strong>{entryDate}</strong></span>
                </div>
              )}
              <Table>
                <TableHeader className="sticky top-0 z-30 bg-background">
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead className="text-right">Wt/Bale</TableHead>
                    <TableHead className="text-right">Total KG</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cart.map((item) => (
                    <TableRow key={item.productId}>
                      <TableCell>
                        <div className="font-medium">{item.product?.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{item.product?.articleCode || item.product?.code}</div>
                      </TableCell>
                      <TableCell className="text-center font-medium">{item.qty}</TableCell>
                      <TableCell className="text-right">{formatNumber(item.weightPerBaleKg)} kg</TableCell>
                      <TableCell className="text-right font-medium">{formatNumber(item.qty * item.weightPerBaleKg)} kg</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="border-t pt-2 flex justify-between items-center font-semibold">
                <span>Total: {totalQty} bales</span>
                <span>{formatNumber(totalKg)} kg</span>
              </div>
              {selectedLogoId && (
                <div className="border-t pt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <img src={`/api/factory/customer-logos/${selectedLogoId}/image`} alt="Selected logo" className="h-6 w-10 object-contain rounded" />
                  <span>Custom logo will be used on labels</span>
                </div>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setConfirmDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={() => {
                  // Pre-open print windows NOW (synchronous user-gesture context)
                  // so the browser won't block them as popups when called after await.
                  preOpenedWindowsRef.current = {
                    a4: window.open("", "_blank"),
                    sticker: window.open("", "_blank"),
                  };
                  stockEntryMutation.mutate();
                }}
                disabled={stockEntryMutation.isPending}
                data-testid="button-dialog-confirm-entry"
              >
                <Printer className="h-4 w-4 mr-2" />
                {stockEntryMutation.isPending ? "Processing..." : "Enter Stock & Print"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={quickCreateOpen} onOpenChange={setQuickCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Quick Create Product</DialogTitle>
              <DialogDescription>Select the grade to auto-generate the article code.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="quick-create-grade">Grade</Label>
                <Select value={quickCreateGrade} onValueChange={setQuickCreateGrade}>
                  <SelectTrigger data-testid="select-quick-create-grade">
                    <SelectValue placeholder="Select grade..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="#1">#1 (HMD11...)</SelectItem>
                    <SelectItem value="#2">#2 (HMD12...)</SelectItem>
                    <SelectItem value="#3">#3 (HMD13...)</SelectItem>
                    <SelectItem value="#4">#4 (HMD14...)</SelectItem>
                    <SelectItem value="CREAM">CREAM (HMD10...)</SelectItem>
                    <SelectItem value="Garbage">Garbage (HMD16...)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="quick-create-name">Name</Label>
                <Input
                  id="quick-create-name"
                  value={quickCreateName}
                  onChange={(e) => setQuickCreateName(e.target.value)}
                  placeholder="Product name..."
                  data-testid="input-quick-create-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quick-create-category">Category</Label>
                <Select value={quickCreateCategoryId} onValueChange={setQuickCreateCategoryId}>
                  <SelectTrigger data-testid="select-quick-create-category">
                    <SelectValue placeholder="Select category..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activeCategories?.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id.toString()}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="quick-create-weight">Weight per Bale (kg)</Label>
                <Input
                  id="quick-create-weight"
                  type="number"
                  value={quickCreateWeight}
                  onChange={(e) => setQuickCreateWeight(e.target.value)}
                  placeholder="Optional - leave empty for default"
                  step="0.1"
                  min={0}
                  data-testid="input-quick-create-weight"
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setQuickCreateOpen(false)}>Cancel</Button>
              <Button
                onClick={() => quickCreateMutation.mutate()}
                disabled={!quickCreateName.trim() || !quickCreateGrade || quickCreateMutation.isPending}
                data-testid="button-quick-create-submit"
              >
                {quickCreateMutation.isPending ? "Creating..." : "Create & Add to Cart"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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

        <Dialog open={designPickerOpen} onOpenChange={(open) => { if (!open) { setDesignPickerOpen(false); setPendingPrintLabels(null); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Choose Label Design</DialogTitle>
              <DialogDescription>Select a brand color for the A4 label header banner.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3 py-2">
              {designColors.map((opt) => (
                <button
                  key={opt.value}
                  data-testid={`button-design-${opt.value}`}
                  className="flex flex-col items-center gap-2 p-3 rounded-md border hover-elevate cursor-pointer"
                  onClick={() => {
                    setDesignPickerOpen(false);
                    if (pendingPrintLabels) {
                      const labels = pendingPrintLabels;
                      setPendingPrintLabels(null);
                      openBrowserPrint(labels, opt.value);
                    }
                  }}
                >
                  <img
                    src={opt.previewUrl}
                    className="w-full h-16 rounded-md object-cover"
                    alt={opt.label}
                  />
                  <span className="text-sm font-medium">{opt.label}</span>
                </button>
              ))}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setDesignPickerOpen(false); setPendingPrintLabels(null); }}>Cancel</Button>
              <Button
                variant="secondary"
                data-testid="button-design-none"
                onClick={() => {
                  setDesignPickerOpen(false);
                  if (pendingPrintLabels) {
                    const labels = pendingPrintLabels;
                    setPendingPrintLabels(null);
                    const paperFormat = getPaperFormat();
                    const labelHtml = paperFormat === "A5" ? generateA5LabelsHtml(labels) : generateCombinedLabelsHtml(labels);
                    const win = window.open("", "_blank");
                    if (win) { win.document.write(labelHtml); win.document.close(); win.focus(); setTimeout(() => win.print(), 500); }
                  }
                }}
              >
                No Design
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  export function RemoveFromStockTab() {
    const [selectedLocationId, setSelectedLocationId] = useState<string>("");
    const [dateFilter, setDateFilter] = useState<string>("");
    const [selectedBaleIds, setSelectedBaleIds] = useState<Set<number>>(new Set());
    const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
    const [supervisorUsername, setSupervisorUsername] = useState("");
    const [supervisorPassword, setSupervisorPassword] = useState("");
    const [removalReason, setRemovalReason] = useState("");
    const [authError, setAuthError] = useState("");
    const [viewMode, setViewMode] = useState<"condensed" | "detailed">("condensed");
    const [designPickerOpen, setDesignPickerOpen] = useState(false);
    const [pendingPrintLabels, setPendingPrintLabels] = useState<LabelData[] | null>(null);
    const [printWorkerBale, setPrintWorkerBale] = useState<any | null>(null);
    const [printWorkerIdSelected, setPrintWorkerIdSelected] = useState<string>("");
    const [assigningWorker, setAssigningWorker] = useState(false);
    const { colors: designColors } = useLabelDesignColors();
    const [importingNames, setImportingNames] = useState(false);
    const [reimporting, setReimporting] = useState(false);
    const namesFileRef = useRef<HTMLInputElement>(null);
    const reimportFileRef = useRef<HTMLInputElement>(null);
    const { toast } = useToast();
    const appMode = useAppMode();
    const modeApiRequest = getApiRequest(appMode);
    const { formatDisplayDate } = useDateFormat();

    const { data: workers = [] } = useQuery<any[]>({ queryKey: ["/api/factory/workers"] });
    const { data: baleProducts } = useQuery<FactoryBaleProduct[]>({ queryKey: ["/api/factory/bale-products"] });

    const bulkUpdateNamesMutation = useMutation({
      mutationFn: async (file: File) => {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/factory/bales/bulk-update-names", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || "Upload failed");
        }
        return res.json();
      },
      onSuccess: (data) => {
        toast({
          title: "Names updated",
          description: `Updated ${data.updated} bale${data.updated !== 1 ? "s" : ""}, skipped ${data.skipped}.`,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      },
      onError: (err: Error) => {
        if (err?._handledGlobally) return;
        toast({ title: "Import failed", description: err.message, variant: "destructive" });
      },
      onSettled: () => setImportingNames(false),
    });

    const reimportMutation = useMutation({
      mutationFn: async (file: File) => {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/factory/bales/reimport", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || "Reimport failed");
        }
        return res.json();
      },
      onSuccess: (data) => {
        toast({
          title: "Bales reimported",
          description: `Successfully reimported ${data.imported} bale(s) (${parseFloat(data.totalWeight).toFixed(1)} kg) with original reference numbers.`,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
        queryClient.invalidateQueries({ queryKey: ["/api/factory/stock-entry/in-stock"] });
      },
      onError: (err: Error) => {
        if (err?._handledGlobally) return;
        toast({ title: "Reimport failed", description: err.message, variant: "destructive" });
      },
      onSettled: () => setReimporting(false),
    });

    const openBrowserPrint = (labels: LabelData[], designColor?: A4DesignColor) => {
      const paperFormat = getPaperFormat();
      // Labels that have an effective color → go to A4/A5 design window
      const labelsForA4 = designColor ? labels : labels.filter((l) => l.designColor);

      if (labelsForA4.length > 0) {
        const labelHtml = paperFormat === "A5" ? generateA5LabelsHtml(labelsForA4) : generateCombinedLabelsHtml(labelsForA4, designColor);
        const a4Window = window.open("", "_blank");
        if (a4Window) {
          a4Window.document.write(labelHtml);
          a4Window.document.close();
          a4Window.focus();
          const a4Imgs = a4Window.document.images;
          let a4Loaded = 0;
          const a4Total = a4Imgs.length;
          const tryA4Print = () => { a4Loaded++; if (a4Loaded >= a4Total) setTimeout(() => a4Window.print(), 200); };
          if (a4Total === 0) { setTimeout(() => a4Window.print(), 200); }
          else { for (let i = 0; i < a4Total; i++) { if (a4Imgs[i].complete) tryA4Print(); else a4Imgs[i].onload = a4Imgs[i].onerror = tryA4Print; } }
        }
      }

      // Sticker/barcode window always prints all labels regardless of color
      const stickerWindow = window.open("", "_blank");
      if (stickerWindow) {
        stickerWindow.document.write(generateStickerLabelsHtml(labels));
        stickerWindow.document.close();
        stickerWindow.focus();
        const imgs = stickerWindow.document.images;
        let loaded = 0;
        const total = imgs.length;
        const tryPrint = () => { loaded++; if (loaded >= total) setTimeout(() => stickerWindow.print(), 300); };
        if (total === 0) { setTimeout(() => stickerWindow.print(), 300); }
        else { for (let i = 0; i < total; i++) { if (imgs[i].complete) tryPrint(); else imgs[i].onload = imgs[i].onerror = tryPrint; } }
      }
    };

    const printDirectNoDesign = (labels: LabelData[]) => {
      // No color assigned — barcode/sticker only, skip the A4 design page
      const stickerWindow = window.open("", "_blank");
      if (stickerWindow) {
        stickerWindow.document.write(generateStickerLabelsHtml(labels));
        stickerWindow.document.close();
        stickerWindow.focus();
        const imgs = stickerWindow.document.images;
        let loaded = 0;
        const total = imgs.length;
        const tryPrint = () => { loaded++; if (loaded >= total) setTimeout(() => stickerWindow.print(), 300); };
        if (total === 0) { setTimeout(() => stickerWindow.print(), 300); }
        else { for (let i = 0; i < total; i++) { if (imgs[i].complete) tryPrint(); else imgs[i].onload = imgs[i].onerror = tryPrint; } }
      }
    };

    const printSingleBale = async (bale: any) => {
      try {
        const labelResponse = await modeApiRequest("POST", "/api/bale-label-prints", {
          bales: [{
            productionBaleId: bale.id,
            productId: bale.productId,
            articleCode: bale.articleCode || "",
            pieces: 1,
            approxWeightKg: bale.weightKg || "0",
          }],
        });
        if (!labelResponse.ok) throw new Error("Failed to create label");
        const { labelPrints } = await labelResponse.json();
        const labels: LabelData[] = labelPrints.map((lp: any) => ({
          referenceNumber: lp.referenceNumber,
          articleCode: lp.articleCode || bale.articleCode || "",
          pieces: lp.pieces || 1,
          approxWeightKg: lp.approxWeightKg || bale.weightKg || "0",
          productName: bale.productName || "",
        }));
        const product = baleProducts?.find((p) => p.id === bale.productId);
        const assignedColor = product?.labelDesignColor as A4DesignColor | null | undefined;
        if (isZebraMode()) {
          try {
            await printRawZpl(buildZplBatch(labels, true));
            toast({ title: "Label sent to Zebra printer" });
          } catch (err: any) {
            if (assignedColor) openBrowserPrint(labels, assignedColor);
            else printDirectNoDesign(labels);
          }
        } else {
          if (assignedColor) openBrowserPrint(labels, assignedColor);
          else printDirectNoDesign(labels);
        }
      } catch (error: any) {
        toast({ title: "Print Error", description: error.message, variant: "destructive" });
      }
    };

    const handlePrintWithWorker = async () => {
      if (!printWorkerBale) return;
      setAssigningWorker(true);
      try {
        if (printWorkerIdSelected) {
          await modeApiRequest("PATCH", `/api/factory/bales/${printWorkerBale.id}/assign-worker`, { workerId: parseInt(printWorkerIdSelected) });
          queryClient.invalidateQueries({ queryKey: ["/api/factory/stock-entry/in-stock"] });
        }
        setPrintWorkerBale(null);
        setPrintWorkerIdSelected("");
        await printSingleBale(printWorkerBale);
      } catch (err: any) {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      } finally {
        setAssigningWorker(false);
      }
    };

    const { data: locations } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
    const activeLocations = locations?.filter((l) => l.active);

    const { data: inStockBales, isLoading: balesLoading } = useQuery<any[]>({
      queryKey: ["/api/factory/stock-entry/in-stock", selectedLocationId],
      queryFn: async () => {
        const locParam = selectedLocationId && selectedLocationId !== "all" ? `?locationId=${selectedLocationId}` : "";
        const url = `/api/factory/stock-entry/in-stock${locParam}`;
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      },
      enabled: true,
    });

    const filteredBales = inStockBales?.filter((bale: any) => {
      if (!dateFilter) return true;
      const baleDate = bale.finalizedAt ? new Date(bale.finalizedAt).toLocaleDateString('en-CA') : null;
      return baleDate === dateFilter;
    });

    const condensedRows = (() => {
      if (!filteredBales) return [];
      const grouped: Record<string, { groupKey: string; articleCode: string; productName: string; qty: number; totalWeight: number; baleIds: number[] }> = {};
      for (const bale of filteredBales) {
        const key = bale.articleCode || bale.productName || `unknown-${bale.id}`;
        if (!grouped[key]) {
          grouped[key] = { groupKey: key, articleCode: bale.articleCode || "-", productName: bale.productName || "-", qty: 0, totalWeight: 0, baleIds: [] };
        }
        grouped[key].qty += 1;
        grouped[key].totalWeight += parseFloat(bale.weightKg || "0");
        grouped[key].baleIds.push(bale.id);
      }
      return Object.values(grouped).sort((a, b) => a.productName.localeCompare(b.productName));
    })();

    const totalQty = filteredBales?.length || 0;
    const totalWeight = filteredBales?.reduce((sum: number, b: any) => sum + parseFloat(b.weightKg || "0"), 0) || 0;

    const toggleBale = (baleId: number) => {
      setSelectedBaleIds((prev) => {
        const next = new Set(prev);
        if (next.has(baleId)) next.delete(baleId);
        else next.add(baleId);
        return next;
      });
    };

    const toggleCondensedRow = (baleIds: number[]) => {
      setSelectedBaleIds((prev) => {
        const next = new Set(prev);
        const allSelected = baleIds.every((id) => next.has(id));
        if (allSelected) {
          baleIds.forEach((id) => next.delete(id));
        } else {
          baleIds.forEach((id) => next.add(id));
        }
        return next;
      });
    };

    const selectAll = () => {
      if (!filteredBales) return;
      const allIds = new Set(filteredBales.map((b: any) => b.id));
      setSelectedBaleIds(allIds);
    };

    const clearSelection = () => setSelectedBaleIds(new Set());

    const handleRemoveClick = () => {
      if (selectedBaleIds.size === 0) {
        toast({ title: "Error", description: "Select at least one bale to remove", variant: "destructive" });
        return;
      }
      setRemoveDialogOpen(true);
      setSupervisorUsername("");
      setSupervisorPassword("");
      setRemovalReason("");
      setAuthError("");
    };

    const removeMutation = useMutation({
      mutationFn: async () => {
        const response = await modeApiRequest("POST", "/api/factory/stock-entry/remove", {
          baleIds: Array.from(selectedBaleIds),
          supervisorUsername,
          supervisorPassword,
          reason: removalReason,
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.message || "Failed to remove bales");
        }

        return await response.json();
      },
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/stock-entry/in-stock"] });
        queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
        queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });

        toast({
          title: "Bales Removed",
          description: `${result.removed} bale(s) removed from stock`,
        });

        setSelectedBaleIds(new Set());
        setRemoveDialogOpen(false);
      },
      onError: (error: Error) => {
        if (error?._handledGlobally) return;
        setAuthError(error.message);
      },
    });

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-56">
              <Select value={selectedLocationId} onValueChange={(v) => { setSelectedLocationId(v); setSelectedBaleIds(new Set()); }}>
                <SelectTrigger data-testid="select-remove-location">
                  <SelectValue placeholder="Filter by location..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {activeLocations?.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id.toString()}>
                      {loc.code} - {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-44">
              <Input
                type="date"
                value={dateFilter}
                onChange={(e) => { setDateFilter(e.target.value); setSelectedBaleIds(new Set()); }}
                data-testid="input-date-filter"
              />
            </div>
            {dateFilter && (
              <Button variant="ghost" size="sm" onClick={() => { setDateFilter(""); setSelectedBaleIds(new Set()); }} data-testid="button-clear-date">
                Clear date
              </Button>
            )}
            {totalQty > 0 && (
              <div className="flex items-center gap-3 ml-2 text-sm" data-testid="text-remove-totals-top">
                <Badge variant="secondary">{totalQty} bales</Badge>
                <Badge variant="secondary">{formatNumber(totalWeight)} kg</Badge>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-0.5 border rounded-md">
              <Button
                variant={viewMode === "condensed" ? "secondary" : "ghost"}
                size="icon"
                onClick={() => setViewMode("condensed")}
                data-testid="button-view-condensed"
                title="Condensed view"
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "detailed" ? "secondary" : "ghost"}
                size="icon"
                onClick={() => setViewMode("detailed")}
                data-testid="button-view-detailed"
                title="Detailed view"
              >
                <LayoutList className="h-4 w-4" />
              </Button>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-tools-menu">
                  Tools
                  <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Export / Import</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => {
                    const exportDate = dateFilter || new Date().toLocaleDateString('en-CA');
                    window.open(`/api/factory/bales/export-full.xlsx?date=${exportDate}`, "_blank");
                  }}
                  data-testid="button-export-bales-full"
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Export Bales ({dateFilter || "Today"})
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => reimportFileRef.current?.click()}
                  disabled={reimportMutation.isPending || reimporting}
                  data-testid="button-reimport-bales"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {reimportMutation.isPending ? "Reimporting..." : "Reimport Bales"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => window.open("/api/factory/bales/export-names.xlsx", "_blank")}
                  data-testid="button-export-bale-names"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export Names
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => namesFileRef.current?.click()}
                  disabled={bulkUpdateNamesMutation.isPending || importingNames}
                  data-testid="button-import-bale-names"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {bulkUpdateNamesMutation.isPending ? "Importing..." : "Import Names"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <input
              ref={reimportFileRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setReimporting(true);
                  reimportMutation.mutate(file);
                  e.target.value = "";
                }
              }}
              data-testid="input-reimport-bales"
            />
            <input
              ref={namesFileRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setImportingNames(true);
                  bulkUpdateNamesMutation.mutate(file);
                  e.target.value = "";
                }
              }}
              data-testid="input-import-bale-names"
            />

            {filteredBales && filteredBales.length > 0 && (
              <>
                <Button variant="outline" size="sm" onClick={selectAll} data-testid="button-select-all">Select All</Button>
                {selectedBaleIds.size > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearSelection} data-testid="button-clear-selection">Clear</Button>
                )}
              </>
            )}
            <Button
              variant="destructive"
              size="sm"
              disabled={selectedBaleIds.size === 0}
              onClick={handleRemoveClick}
              data-testid="button-remove-bales"
            >
              <ShieldAlert className="h-4 w-4 mr-1" />
              Remove ({selectedBaleIds.size})
            </Button>
          </div>
        </div>

        {balesLoading ? (
          <Skeleton className="h-60 w-full" />
        ) : !filteredBales || filteredBales.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="text-lg font-medium">No bales in stock</p>
                <p className="text-sm mt-1">Enter bales using the Stock Entry tab first</p>
              </div>
            </CardContent>
          </Card>
        ) : viewMode === "condensed" ? (
          <Card>
            <CardContent className="p-0">
              <div className="table-responsive">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead>Article</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-center">Qty</TableHead>
                      <TableHead className="text-right">Total Weight (kg)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {condensedRows.map((row) => {
                      const allSelected = row.baleIds.every((id) => selectedBaleIds.has(id));
                      const someSelected = row.baleIds.some((id) => selectedBaleIds.has(id));
                      return (
                        <TableRow
                          key={row.groupKey}
                          className={`cursor-pointer ${allSelected ? "bg-destructive/5" : someSelected ? "bg-destructive/3" : ""}`}
                          onClick={() => toggleCondensedRow(row.baleIds)}
                          data-testid={`row-condensed-${row.groupKey}`}
                        >
                          <TableCell>
                            <div className={`h-4 w-4 rounded border-2 flex items-center justify-center ${allSelected ? "border-destructive bg-destructive" : someSelected ? "border-destructive/50 bg-destructive/30" : "border-muted-foreground/30"}`}>
                              {allSelected && <CheckCircle className="h-3 w-3 text-white" />}
                              {someSelected && !allSelected && <Minus className="h-3 w-3 text-white" />}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-sm text-muted-foreground">{row.articleCode}</TableCell>
                          <TableCell>{row.productName}</TableCell>
                          <TableCell className="text-center font-mono tabular-nums">{row.qty}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{formatNumber(row.totalWeight)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <tfoot>
                    <tr className="border-t-2 font-semibold bg-muted/50">
                      <td className="p-2"></td>
                      <td className="p-2"></td>
                      <td className="p-2 text-sm">Total</td>
                      <td className="p-2 text-center font-mono tabular-nums text-sm">{totalQty}</td>
                      <td className="p-2 text-right font-mono tabular-nums text-sm">{formatNumber(totalWeight)}</td>
                    </tr>
                  </tfoot>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="table-responsive">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead>Ref Number</TableHead>
                      <TableHead>Article</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Weight (kg)</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredBales.map((bale: any) => {
                      const isSelected = selectedBaleIds.has(bale.id);
                      return (
                        <TableRow
                          key={bale.id}
                          className={`cursor-pointer ${isSelected ? "bg-destructive/5" : ""}`}
                          onClick={() => toggleBale(bale.id)}
                          data-testid={`row-stock-bale-${bale.id}`}
                        >
                          <TableCell>
                            <div className={`h-4 w-4 rounded border-2 flex items-center justify-center ${isSelected ? "border-destructive bg-destructive" : "border-muted-foreground/30"}`}>
                              {isSelected && <CheckCircle className="h-3 w-3 text-white" />}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-sm">{bale.referenceNumber}</TableCell>
                          <TableCell className="font-mono text-sm text-muted-foreground">{bale.articleCode || "-"}</TableCell>
                          <TableCell>{bale.productName || "-"}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{formatNumber(parseFloat(bale.weightKg || "0"))}</TableCell>
                          <TableCell>
                            {bale.isInLoadingOrder ? (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 border-amber-400 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 no-default-active-elevate">
                                Loading
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">{bale.status}</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {bale.finalizedAt ? formatDisplayDate(bale.finalizedAt) : "-"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <tfoot>
                    <tr className="border-t-2 font-semibold bg-muted/50">
                      <td className="p-2"></td>
                      <td className="p-2"></td>
                      <td className="p-2"></td>
                      <td className="p-2 text-sm">Total: {totalQty} bales</td>
                      <td className="p-2 text-right font-mono tabular-nums text-sm">{formatNumber(totalWeight)}</td>
                      <td className="p-2"></td>
                      <td className="p-2"></td>
                    </tr>
                  </tfoot>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        <Dialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5" />
                Supervisor Authorization Required
              </DialogTitle>
              <DialogDescription>
                Removing {selectedBaleIds.size} bale(s) from stock requires supervisor credentials. This action will be logged.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Supervisor Username</p>
                <Input
                  value={supervisorUsername}
                  onChange={(e) => { setSupervisorUsername(e.target.value); setAuthError(""); }}
                  placeholder="Enter supervisor username..."
                  data-testid="input-supervisor-username"
                />
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Supervisor Password</p>
                <Input
                  type="password"
                  value={supervisorPassword}
                  onChange={(e) => { setSupervisorPassword(e.target.value); setAuthError(""); }}
                  placeholder="Enter supervisor password..."
                  data-testid="input-supervisor-password"
                />
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Reason for Removal</p>
                <Input
                  value={removalReason}
                  onChange={(e) => setRemovalReason(e.target.value)}
                  placeholder="Entered by mistake, damaged, etc..."
                  data-testid="input-removal-reason"
                />
              </div>
              {authError && (
                <div className="flex items-center gap-2 text-destructive text-sm">
                  <XCircle className="h-4 w-4" />
                  {authError}
                </div>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setRemoveDialogOpen(false)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={!supervisorUsername || !supervisorPassword || removeMutation.isPending}
                onClick={() => removeMutation.mutate()}
                data-testid="button-confirm-remove"
              >
                {removeMutation.isPending ? "Removing..." : "Remove from Stock"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={designPickerOpen} onOpenChange={(open) => { if (!open) { setDesignPickerOpen(false); setPendingPrintLabels(null); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Choose Label Design</DialogTitle>
              <DialogDescription>Select a brand color for the A4 label header banner.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3 py-2">
              {designColors.map((opt) => (
                <button
                  key={opt.value}
                  data-testid={`button-design-${opt.value}`}
                  className="flex flex-col items-center gap-2 p-3 rounded-md border hover-elevate cursor-pointer"
                  onClick={() => {
                    setDesignPickerOpen(false);
                    if (pendingPrintLabels) {
                      const labels = pendingPrintLabels;
                      setPendingPrintLabels(null);
                      openBrowserPrint(labels, opt.value);
                    }
                  }}
                >
                  <img
                    src={opt.previewUrl}
                    className="w-full h-16 rounded-md object-cover"
                    alt={opt.label}
                  />
                  <span className="text-sm font-medium">{opt.label}</span>
                </button>
              ))}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setDesignPickerOpen(false); setPendingPrintLabels(null); }}>Cancel</Button>
              <Button
                variant="secondary"
                data-testid="button-design-none"
                onClick={() => {
                  setDesignPickerOpen(false);
                  if (pendingPrintLabels) {
                    const labels = pendingPrintLabels;
                    setPendingPrintLabels(null);
                    const paperFormat = getPaperFormat();
                    const labelHtml = paperFormat === "A5" ? generateA5LabelsHtml(labels) : generateCombinedLabelsHtml(labels);
                    const a4Window = window.open("", "_blank");
                    if (a4Window) { a4Window.document.write(labelHtml); a4Window.document.close(); a4Window.focus(); setTimeout(() => a4Window.print(), 500); }
                    const stickerWindow = window.open("", "_blank");
                    if (stickerWindow) {
                      stickerWindow.document.write(generateStickerLabelsHtml(labels));
                      stickerWindow.document.close();
                      stickerWindow.focus();
                      const imgs = stickerWindow.document.images;
                      let loaded = 0;
                      const total = imgs.length;
                      const tryPrint = () => { loaded++; if (loaded >= total) setTimeout(() => stickerWindow.print(), 300); };
                      if (total === 0) { setTimeout(() => stickerWindow.print(), 300); }
                      else { for (let i = 0; i < total; i++) { if (imgs[i].complete) tryPrint(); else imgs[i].onload = imgs[i].onerror = tryPrint; } }
                    }
                  }
                }}
              >No Banner (Blank)</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  interface ImportBaleRow {
    itemName: string;
    weight: string;
    barcode: string;
    quantity: number;
    productionDate: string;
    refNumber?: string;
  }

  export function ImportBalesTab() {
    const [selectedLocationId, setSelectedLocationId] = useState<string>("");
    const [importRows, setImportRows] = useState<ImportBaleRow[]>([]);
    const [fileName, setFileName] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { toast } = useToast();
    const appMode = useAppMode();
    const modeApiRequest = getApiRequest(appMode);

    const { data: locations } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
    const activeLocations = locations?.filter((l) => l.active);

    useEffect(() => {
      if (activeLocations && activeLocations.length === 1 && !selectedLocationId) {
        setSelectedLocationId(activeLocations[0].id.toString());
      }
    }, [activeLocations, selectedLocationId]);

    const downloadTemplate = async () => {
      const headers = ["ITEM NAME", "WEIGHT", "ITEM BARCODE", "QUANTITY", "PRODUCTION DATE", "REF NUMBER"];
      const sampleRows = [
        ["Cotton Bale A1", 25, "ART001", 1, "2026-03-14", "MYREF-001"],
        ["Cotton Bale B2", 30, "ART002", 1, "2026-03-14", "MYREF-002"],
      ];
      const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);
      ws["!cols"] = headers.map(() => ({ wch: 20 }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Bale Import Template");
      await XLSX.writeFile(wb, "bale_import_template.xlsx");
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setFileName(file.name);

      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const data = new Uint8Array(evt.target?.result as ArrayBuffer);
          const workbook = await XLSX.read(data, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json<any>(sheet, { header: 1 });

          let headerRowIdx = -1;
          for (let i = 0; i < Math.min(jsonData.length, 10); i++) {
            const row = jsonData[i] as any[];
            if (row && row.some((cell: any) => String(cell).toUpperCase().includes("ITEM NAME"))) {
              headerRowIdx = i;
              break;
            }
          }

          if (headerRowIdx === -1) {
            toast({ title: "Error", description: "Could not find header row with 'ITEM NAME' column", variant: "destructive" });
            return;
          }

          const headers = (jsonData[headerRowIdx] as any[]).map((h: any) => String(h).toUpperCase().trim());
          const nameIdx = headers.findIndex((h) => h.includes("ITEM NAME"));
          const weightIdx = headers.findIndex((h) => h.includes("WEIGHT"));
          const barcodeIdx = headers.findIndex((h) => h.includes("BARCODE"));
          const qtyIdx = headers.findIndex((h) => h.includes("QUANTITY"));
          const dateIdx = headers.findIndex((h) => h.includes("PRODUCTION DATE"));
          const refIdx = headers.findIndex((h) => h.includes("REF NUMBER") || h === "REF" || h === "REF CODE" || h === "REFERENCE");

          // Convert Excel serial date number (e.g. 46096) to YYYY-MM-DD string
          const parseExcelDate = (val: any): string => {
            if (!val && val !== 0) return "";
            const raw = String(val).trim();
            // Already looks like a date string (YYYY-MM-DD or DD/MM/YYYY etc.)
            if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
            if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(raw)) {
              const parts = raw.split(/[\/\-]/);
              return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
            }
            // Excel serial number: days since 1899-12-30 (accounting for Excel's leap year bug)
            const serial = parseFloat(raw);
            if (!isNaN(serial) && serial > 0) {
              const ms = (serial - 25569) * 86400000; // 25569 = days between 1900-01-01 and 1970-01-01
              const d = new Date(ms);
              if (!isNaN(d.getTime())) {
                const y = d.getUTCFullYear();
                const m = String(d.getUTCMonth() + 1).padStart(2, "0");
                const day = String(d.getUTCDate()).padStart(2, "0");
                return `${y}-${m}-${day}`;
              }
            }
            return raw;
          };

          const rows: ImportBaleRow[] = [];
          for (let i = headerRowIdx + 1; i < jsonData.length; i++) {
            const row = jsonData[i] as any[];
            if (!row || !row[nameIdx]) continue;
            const itemName = String(row[nameIdx] || "").trim();
            if (!itemName) continue;
            rows.push({
              itemName,
              weight: String(row[weightIdx] || "").trim(),
              barcode: String(row[barcodeIdx] || "").trim(),
              quantity: parseInt(String(row[qtyIdx] || "1")) || 1,
              productionDate: dateIdx >= 0 ? parseExcelDate(row[dateIdx]) : "",
              refNumber: refIdx >= 0 ? String(row[refIdx] || "").trim() : undefined,
            });
          }

          if (rows.length === 0) {
            toast({ title: "Warning", description: "No data rows found in the Excel file", variant: "destructive" });
            return;
          }

          setImportRows(rows);
          toast({ title: "File Parsed", description: `Found ${rows.length} bale(s) to import` });
        } catch (err: any) {
          toast({ title: "Parse Error", description: err.message || "Failed to parse Excel file", variant: "destructive" });
        }
      };
      reader.readAsArrayBuffer(file);
    };

    const importMutation = useMutation({
      mutationFn: async () => {
        const response = await modeApiRequest("POST", "/api/factory/bales/import", {
          erpLocationId: parseInt(selectedLocationId),
          bales: importRows,
        });
        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.message || "Failed to import bales");
        }
        return await response.json();
      },
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
        queryClient.invalidateQueries({ queryKey: ["/api/factory/stock-entry/in-stock"] });
        queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });
        toast({ title: "Import Complete", description: `${result.imported || importRows.length} bale(s) imported successfully` });
        setImportRows([]);
        setFileName("");
        if (fileInputRef.current) fileInputRef.current.value = "";
      },
      onError: (error: Error) => {
        if (error?._handledGlobally) return;
        toast({ title: "Import Error", description: error.message, variant: "destructive" });
      },
    });

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="text-sm text-muted-foreground mb-1.5">Warehouse Location</p>
            <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
              <SelectTrigger data-testid="select-import-location">
                <SelectValue placeholder="Select Location..." />
              </SelectTrigger>
              <SelectContent>
                {activeLocations?.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id.toString()}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1.5">Upload Excel File</p>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv"
                onChange={handleFileUpload}
                className="hidden"
                data-testid="input-import-file"
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-upload-excel"
              >
                <Upload className="h-4 w-4 mr-2" />
                {fileName || "Choose File..."}
              </Button>
              <Button
                variant="outline"
                onClick={downloadTemplate}
                data-testid="button-download-template"
              >
                <Download className="h-4 w-4 mr-2" />
                Download Template
              </Button>
              {fileName && (
                <Badge variant="secondary" data-testid="badge-file-name">
                  <FileSpreadsheet className="h-3 w-3 mr-1" />
                  {fileName}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {importRows.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-lg">Preview ({importRows.length} rows)</CardTitle>
                <Button
                  onClick={() => importMutation.mutate()}
                  disabled={!selectedLocationId || importMutation.isPending}
                  data-testid="button-import-submit"
                >
                  {importMutation.isPending ? "Importing..." : `Import ${importRows.length} Bales`}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Item Name</TableHead>
                      <TableHead className="text-right">Weight</TableHead>
                      <TableHead>Barcode</TableHead>
                      <TableHead>Ref Number</TableHead>
                      <TableHead className="text-center">Qty</TableHead>
                      <TableHead>Production Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importRows.map((row, idx) => (
                      <TableRow key={idx} data-testid={`row-import-${idx}`}>
                        <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="font-medium" data-testid={`text-import-name-${idx}`}>{row.itemName}</TableCell>
                        <TableCell className="text-right" data-testid={`text-import-weight-${idx}`}>{row.weight}</TableCell>
                        <TableCell className="font-mono text-sm" data-testid={`text-import-barcode-${idx}`}>{row.barcode}</TableCell>
                        <TableCell className="font-mono text-sm" data-testid={`text-import-ref-${idx}`}>{row.refNumber || <span className="text-muted-foreground text-xs">auto</span>}</TableCell>
                        <TableCell className="text-center" data-testid={`text-import-qty-${idx}`}>{row.quantity}</TableCell>
                        <TableCell data-testid={`text-import-date-${idx}`}>{row.productionDate}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {importRows.length === 0 && (
          <Card>
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <FileSpreadsheet className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p className="font-medium" data-testid="text-import-empty">Upload an Excel file to preview bales for import</p>
                <p className="text-sm mt-1">Expected columns: ITEM NAME, WEIGHT, ITEM BARCODE, QUANTITY, PRODUCTION DATE, REF NUMBER (optional)</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  function formatDailyNum(val: number): string {
    if (val === 0) return "0";
    return val % 1 === 0 ? val.toFixed(0) : parseFloat(val.toFixed(3)).toString();
  }

  function DailyStockSummary({ date }: { date: string }) {
    const todayStr = new Date().toLocaleDateString('en-CA');

    const { data: summaryRows = [] } = useQuery<any[]>({
      queryKey: ["/api/factory/bales/daily-summary", date],
      queryFn: () =>
        fetch(`/api/factory/bales/daily-summary?date=${date}`, { credentials: "include" })
          .then(r => r.json()),
      staleTime: 30000,
    });

    let totalQty = 0, totalKg = 0;
    let garbageQty = 0, garbageKg = 0;
    let wipersQty = 0, wipersKg = 0;

    for (const row of summaryRows) {
      const cat = (row.category || "").toLowerCase().trim();
      const qty = Number(row.count || 0);
      const kg = parseFloat(row.totalKg || "0");
      if (cat === "garbage") { garbageQty += qty; garbageKg += kg; }
      else if (cat === "wipers") { wipersQty += qty; wipersKg += kg; }
      else { totalQty += qty; totalKg += kg; }
    }

    const isToday = date === todayStr;

    return (
      <div className="flex items-center gap-2 flex-wrap">
        {/* Label */}
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground whitespace-nowrap">
          {isToday ? "Today" : "Production"}
        </span>

        {/* Production */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-emerald-500/10 border-emerald-500/20">
          <Factory className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          <span className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400" data-testid="text-entry-today-qty">{totalQty}</span>
          <span className="text-xs text-emerald-600/70 dark:text-emerald-400/70">bales</span>
          <span className="w-px h-3 bg-emerald-500/30" />
          <span className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400" data-testid="text-entry-today-kg">{formatDailyNum(totalKg)}</span>
          <span className="text-xs text-emerald-600/70 dark:text-emerald-400/70">kg</span>
        </div>

        {/* Garbage */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-orange-500/10 border-orange-500/20">
          <span className="text-xs font-semibold text-orange-500">Garbage</span>
          <span className="text-sm font-bold tabular-nums text-orange-600 dark:text-orange-400" data-testid="text-entry-garbage-qty">{garbageQty}</span>
          <span className="text-xs text-orange-600/70 dark:text-orange-400/70">bales</span>
          <span className="w-px h-3 bg-orange-500/30" />
          <span className="text-sm font-bold tabular-nums text-orange-600 dark:text-orange-400" data-testid="text-entry-garbage-kg">{formatDailyNum(garbageKg)}</span>
          <span className="text-xs text-orange-600/70 dark:text-orange-400/70">kg</span>
        </div>

        {/* Wipers */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-blue-500/10 border-blue-500/20">
          <span className="text-xs font-semibold text-blue-500">Wipers</span>
          <span className="text-sm font-bold tabular-nums text-blue-600 dark:text-blue-400" data-testid="text-entry-wipers-qty">{wipersQty}</span>
          <span className="text-xs text-blue-600/70 dark:text-blue-400/70">bales</span>
          <span className="w-px h-3 bg-blue-500/30" />
          <span className="text-sm font-bold tabular-nums text-blue-600 dark:text-blue-400" data-testid="text-entry-wipers-kg">{formatDailyNum(wipersKg)}</span>
          <span className="text-xs text-blue-600/70 dark:text-blue-400/70">kg</span>
        </div>
      </div>
    );
  }

  export default function BaleStockEntry() {
    const todayStr = new Date().toLocaleDateString('en-CA');
    const [summaryDate, setSummaryDate] = useState<string>(todayStr);
    const { toast } = useToast();
    // Track which tabs have ever been activated so we only mount heavy components on demand.
    const [mountedTabs, setMountedTabs] = useState<Set<string>>(() => new Set(["entry"]));
    const handleTabChange = (tab: string) =>
      setMountedTabs(prev => prev.has(tab) ? prev : new Set([...prev, tab]));

    const { data: settings } = useQuery<any>({
      queryKey: ["/api/factory/settings"],
      queryFn: async () => { const r = await fetch("/api/factory/settings"); return r.ok ? r.json() : {}; },
      staleTime: 60000,
    });

    const { data: myAccess } = useQuery<any>({ queryKey: ["/api/factory/my-access"], staleTime: 60000 });
    const hiddenTabs = myAccess?.hiddenCostFields ?? [];

    const showEntry      = settings?.stockEntryTabEntryEnabled   !== false && !hiddenTabs.includes("hide_tab_stockentry_entry");
    const showHistory    = settings?.stockEntryTabHistoryEnabled !== false && !hiddenTabs.includes("hide_tab_stockentry_history");
    const showGroundScan = !hiddenTabs.includes("hide_tab_stockentry_ground_scan");
    const showDailyScan  = !hiddenTabs.includes("hide_tab_stockentry_daily_scan");

    const { data: productionSession, refetch: refetchSession } = useQuery<any>({
      queryKey: ["/api/factory/stock-entry/production-session", todayStr],
      queryFn: async () => {
        const r = await fetch(`/api/factory/stock-entry/production-session?date=${todayStr}`);
        return r.ok ? r.json() : null;
      },
      staleTime: 30000,
    });
    const productionAlreadyEnded = !!productionSession?.productionEndedAt;

    // ── Worker Categories management ───────────────────────────────────────
    const { appMode } = useAppMode();
    const catApiRequest = getApiRequest(appMode);
    const [catDialogOpen, setCatDialogOpen] = useState(false);
    const [editingCat, setEditingCat] = useState<any>(null);
    const [catName, setCatName] = useState("");
    const [catWorkerIds, setCatWorkerIds] = useState<number[]>([]);

    const { data: catWorkers = [] } = useQuery<any[]>({
      queryKey: ["/api/factory/workers"],
      queryFn: () => fetch("/api/factory/workers", { credentials: "include" }).then(r => r.json()),
    });
    const { data: workerCategories = [], isLoading: catsLoading } = useQuery<any[]>({
      queryKey: ["/api/factory/worker-categories"],
      queryFn: () => fetch("/api/factory/worker-categories", { credentials: "include" }).then(r => r.json()),
    });

    const createCatMutation = useMutation({
      mutationFn: (data: { name: string; workerIds: number[] }) =>
        catApiRequest("POST", "/api/factory/worker-categories", data),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/worker-categories"] });
        setCatDialogOpen(false);
        toast({ title: "Category created" });
      },
      onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    });
    const updateCatMutation = useMutation({
      mutationFn: (data: { id: number; name: string; workerIds: number[] }) =>
        catApiRequest("PATCH", `/api/factory/worker-categories/${data.id}`, { name: data.name, workerIds: data.workerIds }),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/worker-categories"] });
        setCatDialogOpen(false);
        toast({ title: "Category updated" });
      },
      onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    });
    const deleteCatMutation = useMutation({
      mutationFn: (id: number) => catApiRequest("DELETE", `/api/factory/worker-categories/${id}`),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/worker-categories"] });
        toast({ title: "Category deleted" });
      },
      onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    });

    const openNewCat = () => { setEditingCat(null); setCatName(""); setCatWorkerIds([]); setCatDialogOpen(true); };
    const openEditCat = (cat: any) => { setEditingCat(cat); setCatName(cat.name); setCatWorkerIds(Array.isArray(cat.workerIds) ? cat.workerIds : []); setCatDialogOpen(true); };
    const toggleCatWorker = (id: number) => setCatWorkerIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    const saveCat = () => {
      if (!catName.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
      const activeIds = catWorkers.filter((w: any) => w.active !== false).map((w: any) => w.id);
      const filtered = catWorkerIds.filter(id => activeIds.includes(id));
      if (editingCat) updateCatMutation.mutate({ id: editingCat.id, name: catName.trim(), workerIds: filtered });
      else createCatMutation.mutate({ name: catName.trim(), workerIds: filtered });
    };
    // ── End Worker Categories ──────────────────────────────────────────────

    const endProductionMutation = useMutation({
      mutationFn: async () => {
        const res = await apiRequest("POST", "/api/factory/stock-entry/end-production", { date: todayStr });
        if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Failed to end production"); }
        return res.json();
      },
      onSuccess: () => {
        toast({ title: "Production ended", description: "Worker Matrix PDF sent to WhatsApp group." });
        refetchSession();
      },
      onError: (err: any) => {
        if (err?._handledGlobally) return;
        toast({ title: "End Production failed", description: err.message, variant: "destructive" });
      },
    });

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500/30 to-emerald-600/10 border border-emerald-500/25 shrink-0">
              <ScanLine className="h-4.5 w-4.5 text-emerald-500" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">Bale Stock Entry</h1>
              <p className="text-xs text-muted-foreground leading-tight">Scan and record bale production</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LabelPrintSettings />
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold tracking-widest bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25" data-testid="badge-stock-entry">
              <Factory className="h-3 w-3" />
              STOCK ENTRY
            </span>
          </div>
        </div>

        <DailyStockSummary date={summaryDate} />

        <Tabs defaultValue={showEntry ? "entry" : "history"} onValueChange={handleTabChange}>
          <TabsList>
            {showEntry && (
              <TabsTrigger value="entry" data-testid="tab-stock-entry">
                <ScanLine className="h-4 w-4 mr-1" />
                Stock Entry
              </TabsTrigger>
            )}
            {showHistory && (
              <TabsTrigger value="history" data-testid="tab-stock-entry-history">
                <List className="h-4 w-4 mr-1" />
                Stock Entry History
              </TabsTrigger>
            )}
            {showGroundScan && (
              <TabsTrigger value="ground-scan" data-testid="tab-ground-scan">
                <ScanLine className="h-4 w-4 mr-1" />
                Ground Scan
              </TabsTrigger>
            )}
            {showDailyScan && (
              <TabsTrigger value="daily-scan" data-testid="tab-daily-scan">
                <CalendarDays className="h-4 w-4 mr-1" />
                Daily Scan
              </TabsTrigger>
            )}
            <TabsTrigger value="worker-categories" data-testid="tab-worker-categories">
              <Tag className="h-4 w-4 mr-1" />
              Worker Categories
            </TabsTrigger>
          </TabsList>
          {showEntry && (
            <TabsContent value="entry" className="mt-4">
              <StockEntryTab />
            </TabsContent>
          )}
          {showHistory && (
            <TabsContent value="history" className="mt-0 p-0">
              {mountedTabs.has("history") && (
                <StockEntryHistory
                  onActiveDateChange={(d) => setSummaryDate(d ?? todayStr)}
                />
              )}
            </TabsContent>
          )}
          {showGroundScan && (
            <TabsContent value="ground-scan" className="mt-0 p-0">
              {mountedTabs.has("ground-scan") && <GroundScan />}
            </TabsContent>
          )}
          {showDailyScan && (
            <TabsContent value="daily-scan" className="mt-0 p-0">
              {mountedTabs.has("daily-scan") && <DailyScan />}
            </TabsContent>
          )}
          <TabsContent value="worker-categories" className="mt-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="font-medium">Worker Categories</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Group workers into categories to quickly filter them during stock entry.
                  </p>
                </div>
                <Button onClick={openNewCat} data-testid="button-add-worker-category">
                  <Plus className="h-4 w-4 mr-2" />New Category
                </Button>
              </div>

              {catsLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[1,2,3].map(i => <div key={i} className="h-28 rounded-md bg-muted animate-pulse" />)}
                </div>
              ) : workerCategories.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground border rounded-md">
                  <Layers className="mx-auto h-8 w-8 mb-3 opacity-40" />
                  <p className="font-medium">No categories yet</p>
                  <p className="text-sm mt-1">Create a category to group workers for quick filtering</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {workerCategories.map((cat: any) => {
                    const ids: number[] = Array.isArray(cat.workerIds) ? cat.workerIds : [];
                    const members = catWorkers.filter((w: any) => ids.includes(w.id));
                    const activeMembers = members.filter((w: any) => w.active !== false);
                    return (
                      <Card key={cat.id} data-testid={`card-wcat-${cat.id}`}>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold text-sm">{cat.name}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {activeMembers.length} active worker{activeMembers.length !== 1 ? "s" : ""}
                                {ids.length > activeMembers.length && (
                                  <span className="ml-1">({ids.length - activeMembers.length} inactive)</span>
                                )}
                              </p>
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                              <Button size="icon" variant="ghost" onClick={() => openEditCat(cat)} data-testid={`button-edit-wcat-${cat.id}`}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon" variant="ghost"
                                onClick={() => deleteCatMutation.mutate(cat.id)}
                                disabled={deleteCatMutation.isPending}
                                data-testid={`button-delete-wcat-${cat.id}`}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </div>
                          </div>
                          {activeMembers.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {activeMembers.slice(0, 6).map((w: any) => (
                                <Badge key={w.id} variant="secondary" className="text-xs font-normal no-default-active-elevate">
                                  {w.fullName}
                                </Badge>
                              ))}
                              {activeMembers.length > 6 && (
                                <Badge variant="outline" className="text-xs font-normal no-default-active-elevate">
                                  +{activeMembers.length - 6} more
                                </Badge>
                              )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Worker Categories Dialog */}
        <Dialog open={catDialogOpen} onOpenChange={(open) => { if (!open) setCatDialogOpen(false); }}>
          <DialogContent className="max-w-md" data-testid="dialog-wcat-form">
            <DialogHeader>
              <DialogTitle>{editingCat ? "Edit Category" : "New Category"}</DialogTitle>
              <DialogDescription>
                {editingCat ? "Update the category name and worker assignments." : "Create a group of workers for easy filtering."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1">
                <Label className="text-xs">Category Name *</Label>
                <Input
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  placeholder="e.g. Pressing Team A"
                  data-testid="input-wcat-name"
                  onKeyDown={(e) => { if (e.key === "Enter") saveCat(); }}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Workers</Label>
                <div className="border rounded-md divide-y max-h-64 overflow-y-auto">
                  {catWorkers.filter((w: any) => w.active !== false || catWorkerIds.includes(w.id)).map((w: any) => (
                    <label
                      key={w.id}
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover-elevate ${w.active === false ? "opacity-50" : ""}`}
                      data-testid={`label-wcat-worker-${w.id}`}
                    >
                      <Checkbox
                        checked={catWorkerIds.includes(w.id)}
                        onCheckedChange={() => w.active !== false ? toggleCatWorker(w.id) : undefined}
                        disabled={w.active === false}
                        data-testid={`checkbox-wcat-worker-${w.id}`}
                      />
                      <span className="text-sm flex-1">{w.fullName}</span>
                      {w.active === false && <Badge variant="secondary" className="text-xs no-default-active-elevate">Inactive</Badge>}
                    </label>
                  ))}
                  {catWorkers.filter((w: any) => w.active !== false || catWorkerIds.includes(w.id)).length === 0 && (
                    <p className="text-sm text-muted-foreground px-3 py-4 text-center">No workers available</p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {catWorkerIds.filter(id => catWorkers.find((w: any) => w.id === id && w.active !== false)).length} active workers selected.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCatDialogOpen(false)} data-testid="button-cancel-wcat">Cancel</Button>
              <Button
                onClick={saveCat}
                disabled={createCatMutation.isPending || updateCatMutation.isPending}
                data-testid="button-save-wcat"
              >
                {(createCatMutation.isPending || updateCatMutation.isPending) ? "Saving..." : editingCat ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }