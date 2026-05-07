import { useState, useEffect, Fragment, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight, ChevronUp, MapPin, Package, Trash2, Check, AlertCircle, ArrowRight, Settings2, CalendarIcon, FileDown, List, GitBranch, Upload, FileSpreadsheet, TrendingUp, TrendingDown, ExternalLink } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { writeFile, readFile, utils, ExcelJS } from "@/lib/excelHelper";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { PeriodFilter, getDefaultPeriodValue, PeriodFilterValue } from "@/components/ui/period-filter";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatNumber } from "@/lib/formatNumber";

interface LocationData {
  quantity: number;
  rate: number;
  value: number;
}

interface StockItemData {
  id: number;
  code: string;
  name: string;
  uom: string;
  locationData: Record<number, LocationData>;
}

interface StockGroupData {
  id: number;
  code: string;
  name: string;
  locationData: Record<number, LocationData>;
  items: StockItemData[];
}

interface LocationSummaryResponse {
  stockGroups: StockGroupData[];
  grandTotals: Record<number, LocationData>;
  asOfDate: string;
}

interface Location {
  id: number;
  name: string;
  code: string;
}

interface OrderItem {
  stockItemId: number;
  stockItemName: string;
  stockItemCode: string;
  uom: string;
  sourceLocationId: number;
  sourceLocationName: string;
  quantity: number;
  availableQty: number;
  rate: number;
}

interface QuantityPickerState {
  open: boolean;
  stockItem: StockItemData | null;
  locationId: number;
  locationName: string;
  availableQty: number;
}

interface ImportPreviewRow {
  rawCode: string;
  rawName: string;
  stockItemId: number | null;
  stockItemName: string;
  currentQty: number;
  change: number;
  newQty: number;
  sourceLocationId: number | null;
  sourceLocationName: string;
  status: 'ok' | 'not_found' | 'remove' | 'new_item';
}

const STORAGE_KEY = "stockTransferOrder_selectedLocations";
const SESSION_STATE_KEY = "stockTransferOrder_session_state";
const DRAFT_KEY = "stockTransferOrder_autosave_draft";

export default function StockTransferOrder() {
  const [_location, navigate] = useLocation();
  const { toast } = useToast();
  const { selectedCompany } = useCompany();

  const editVoucherId = (() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get("edit");
    return v ? parseInt(v) : null;
  })();

  const [selectedLocationIds, setSelectedLocationIds] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  // Restore state from sessionStorage once (when navigating back from history view, only for new transfers)
  const _sessionSnapshot = (() => {
    if (editVoucherId !== null) return null; // don't restore when editing existing voucher
    try {
      const ss = sessionStorage.getItem(SESSION_STATE_KEY);
      if (ss) { sessionStorage.removeItem(SESSION_STATE_KEY); return JSON.parse(ss); }
    } catch {}
    return null;
  })();

  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(
    () => new Set<number>(_sessionSnapshot?.expandedGroups || [])
  );
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [destinationLocationId, setDestinationLocationId] = useState<number | null>(
    () => _sessionSnapshot?.destinationLocationId ?? null
  );
  const [orderItems, setOrderItems] = useState<OrderItem[]>(
    () => _sessionSnapshot?.orderItems || []
  );
  
  const [quantityPicker, setQuantityPicker] = useState<QuantityPickerState>({
    open: false,
    stockItem: null,
    locationId: 0,
    locationName: "",
    availableQty: 0,
  });
  const [pickerQuantity, setPickerQuantity] = useState("");
  
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transferDate, setTransferDate] = useState<Date>(new Date());
  const [isOptional, setIsOptional] = useState(false);
  const [editDataLoaded, setEditDataLoaded] = useState(false);
  
  const quantityInputRef = useRef<HTMLInputElement>(null);
  const matrixRef = useRef<HTMLDivElement>(null);
  const [focusedCell, setFocusedCell] = useState<{ row: number; col: number } | null>(null);
  const prevDialogOpen = useRef(false);

  // Autosave draft state (new transfers only)
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [hasDraft, setHasDraft] = useState<boolean>(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Revision state
  const [revisionDialogOpen, setRevisionDialogOpen] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");
  const [isSavingRevision, setIsSavingRevision] = useState(false);
  const [revisionsExpanded, setRevisionsExpanded] = useState(false);

  // Import state
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreviewRow[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  // History dialog state
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [historyItem, setHistoryItem] = useState<StockItemData | null>(null);
  const [historyLocation, setHistoryLocation] = useState<Location | null>(null);
  const [historyPeriod, setHistoryPeriod] = useState<PeriodFilterValue>(
    () => getDefaultPeriodValue("this_year")
  );

  // Drill-down detail dialog state
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailYear, setDetailYear] = useState(new Date().getFullYear());
  const [detailMonth, setDetailMonth] = useState(0);
  const [detailMonthName, setDetailMonthName] = useState("");
  const [detailDirection, setDetailDirection] = useState<"in" | "out">("out");

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { formatAmount } = useCurrencyContext();

  // History dialog data query
  const { data: historyData, isLoading: historyLoading } = useQuery<any>({
    queryKey: [
      "/api/locations",
      historyLocation?.id,
      "stock-items",
      historyItem?.id,
      "monthly-summary",
      { startDate: historyPeriod.fromDate, endDate: historyPeriod.toDate },
    ],
    queryFn: async () => {
      const res = await fetch(
        `/api/locations/${historyLocation!.id}/stock-items/${historyItem!.id}/monthly-summary?startDate=${historyPeriod.fromDate}&endDate=${historyPeriod.toDate}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch history");
      return res.json();
    },
    enabled: historyDialogOpen && !!historyItem && !!historyLocation,
  });

  const { data: detailData, isLoading: detailLoading } = useQuery<{ inTransactions: any[]; outTransactions: any[] }>({
    queryKey: [
      "/api/locations",
      historyLocation?.id,
      "stock-items",
      historyItem?.id,
      "monthly-detail",
      { year: detailYear, month: detailMonth },
    ],
    queryFn: async () => {
      const res = await fetch(
        `/api/locations/${historyLocation!.id}/stock-items/${historyItem!.id}/monthly-detail?year=${detailYear}&month=${detailMonth}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch detail");
      return res.json();
    },
    enabled: detailOpen && !!historyItem && !!historyLocation && detailMonth > 0,
  });

  const { data: existingTransfer } = useQuery<any>({
    queryKey: ["/api/stock-transfers", editVoucherId],
    queryFn: async () => {
      const res = await fetch(`/api/stock-transfers?voucherId=${editVoucherId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch transfer");
      return res.json();
    },
    enabled: !!editVoucherId,
  });

  const { data: existingVoucher } = useQuery<any>({
    queryKey: ["/api/vouchers", editVoucherId],
    queryFn: async () => {
      const res = await fetch(`/api/vouchers/${editVoucherId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch voucher");
      return res.json();
    },
    enabled: !!editVoucherId,
  });

  const { data: stockItems = [] } = useQuery<Array<{ id: number; name: string; code: string; uom: string }>>({
    queryKey: ["/api/stock-items"],
  });

  const { data: revisions = [] } = useQuery<any[]>({
    queryKey: ["/api/stock-transfers", existingTransfer?.id, "revisions"],
    queryFn: async () => {
      const res = await fetch(`/api/stock-transfers/${existingTransfer!.id}/revisions`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch revisions");
      return res.json();
    },
    enabled: !!existingTransfer?.id,
  });

  const { data: summaryData, isLoading } = useQuery<LocationSummaryResponse>({
    queryKey: ["/api/location-summary", { locationIds: selectedLocationIds.join(',') }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedLocationIds.length > 0) {
        params.append('locationIds', selectedLocationIds.join(','));
      }
      const res = await fetch(`/api/location-summary?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch location summary');
      return res.json();
    },
    enabled: selectedLocationIds.length > 0,
  });

  useEffect(() => {
    if (!editVoucherId) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedLocationIds));
    }
  }, [selectedLocationIds, editVoucherId]);

  // Load date and optional as soon as the voucher header loads (independent of items)
  useEffect(() => {
    if (!editVoucherId || !existingVoucher) return;
    if (existingVoucher.voucherDate) {
      const parts = existingVoucher.voucherDate.split("-");
      if (parts.length === 3) {
        setTransferDate(new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
      } else {
        setTransferDate(new Date(existingVoucher.voucherDate));
      }
    }
    setIsOptional(existingVoucher.optional === true);
  }, [editVoucherId, existingVoucher]);

  // Load items and destination once both transfer data and reference data are ready
  useEffect(() => {
    if (editVoucherId && existingTransfer && existingVoucher && locations.length > 0 && stockItems.length > 0 && !editDataLoaded) {
      const destId = existingTransfer.destinationLocationId;
      if (destId) setDestinationLocationId(destId);

      if (existingTransfer.items && existingTransfer.items.length > 0) {
        setSelectedLocationIds(locations.map((l) => l.id));

        const preloaded: OrderItem[] = existingTransfer.items.map((item: any) => {
          const srcLoc = locations.find((l) => l.id === item.sourceLocationId);
          const stockItem = stockItems.find((s) => s.id === item.stockItemId);
          return {
            stockItemId: item.stockItemId,
            stockItemName: stockItem?.name || "",
            stockItemCode: stockItem?.code || "",
            uom: stockItem?.uom || "",
            sourceLocationId: item.sourceLocationId,
            sourceLocationName: srcLoc?.name || "",
            quantity: parseFloat(item.quantity) || 0,
            availableQty: parseFloat(item.quantity) || 0,
            rate: parseFloat(item.rate) || 0,
          };
        });
        setOrderItems(preloaded);
      }

      setEditDataLoaded(true);
    }
  }, [editVoucherId, existingTransfer, existingVoucher, locations, stockItems, editDataLoaded]);

  // On mount: check for existing draft (new transfers only)
  useEffect(() => {
    if (editVoucherId !== null) return;
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const d = JSON.parse(saved);
        if (d?.orderItems?.length > 0 || d?.destinationLocationId) {
          setHasDraft(true);
        }
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave debounce effect (new transfers only)
  useEffect(() => {
    if (editVoucherId !== null) return;
    if (!destinationLocationId && orderItems.length === 0) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      setAutosaveStatus("saving");
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          destinationLocationId,
          orderItems,
          transferDate: transferDate.toISOString(),
          isOptional,
          savedAt: new Date().toISOString(),
        }));
        setAutosaveStatus("saved");
      } catch {
        setAutosaveStatus("failed");
      }
    }, 800);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  }, [destinationLocationId, orderItems, transferDate, isOptional, editVoucherId]);

  const restoreDraft = async () => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (!saved) return;
      const d = JSON.parse(saved);
      if (d.destinationLocationId) setDestinationLocationId(d.destinationLocationId);
      if (d.orderItems) setOrderItems(d.orderItems);
      if (d.transferDate) setTransferDate(new Date(d.transferDate));
      if (d.isOptional !== undefined) setIsOptional(d.isOptional);
      setHasDraft(false);
      toast({ title: "Draft restored" });
    } catch {
      toast({ title: "Could not restore draft", variant: "destructive" });
    }
  };

  const discardDraft = async () => {
    localStorage.removeItem(DRAFT_KEY);
    setHasDraft(false);
  };

  useEffect(() => {
    if (prevDialogOpen.current && !quantityPicker.open) {
      requestAnimationFrame(() => {
        matrixRef.current?.focus({ preventScroll: true });
      });
    }
    prevDialogOpen.current = quantityPicker.open;
  }, [quantityPicker.open]);

  useEffect(() => {
    if (focusedCell === null) return;
    const el = matrixRef.current?.querySelector('[data-focused="true"]');
    el?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [focusedCell]);

  const selectedLocations = selectedLocationIds
    .map(id => locations.find(loc => loc.id === id))
    .filter((loc): loc is Location => loc !== undefined);

  const availableDestinations = locations;

  const toggleGroup = async (groupId: number) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const toggleLocation = async (locationId: number) => {
    setSelectedLocationIds(prev => 
      prev.includes(locationId) 
        ? prev.filter(id => id !== locationId)
        : [...prev, locationId]
    );
  };

  const sortOrderItems = (items: OrderItem[]): OrderItem[] => {
    return [...items].sort((a, b) => a.sourceLocationName.localeCompare(b.sourceLocationName));
  };

  const flatItems = summaryData?.stockGroups.flatMap((group) => 
    expandedGroups.has(group.id) 
      ? [...group.items].sort((a, b) => a.name.localeCompare(b.name))
      : []
  ) || [];

  const openQuantityPicker = useCallback((
    item: StockItemData,
    locationId: number,
    locationName: string,
    availableQty: number
  ) => {
    if (availableQty <= 0) {
      toast({
        title: "No Stock",
        description: `${item.name} has no available stock at ${locationName}`,
        variant: "destructive",
      });
      return;
    }

    setQuantityPicker({
      open: true,
      stockItem: item,
      locationId,
      locationName,
      availableQty,
    });
    setPickerQuantity("");
    
    setTimeout(() => {
      quantityInputRef.current?.focus();
    }, 100);
  }, [toast]);

  const handleMatrixKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (quantityPicker.open) return;
    if (flatItems.length === 0 || selectedLocations.length === 0) return;

    const { key } = e;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Enter'].includes(key)) return;

    e.preventDefault();

    if (key === 'Enter' && focusedCell !== null) {
      const item = flatItems[focusedCell.row];
      const loc = selectedLocations[focusedCell.col];
      if (item && loc) {
        setHistoryItem(item);
        setHistoryLocation(loc);
        setHistoryPeriod(getDefaultPeriodValue("this_year"));
        setHistoryDialogOpen(true);
      }
      return;
    }

    setFocusedCell((current) => {
      const maxRow = flatItems.length - 1;
      const maxCol = selectedLocations.length - 1;

      if (current === null) {
        return { row: 0, col: 0 };
      }

      let { row, col } = current;

      switch (key) {
        case 'ArrowUp':
          row = Math.max(0, row - 1);
          break;
        case 'ArrowDown':
          row = Math.min(maxRow, row + 1);
          break;
        case 'ArrowLeft':
          col = Math.max(0, col - 1);
          break;
        case 'ArrowRight':
          col = Math.min(maxCol, col + 1);
          break;
        case ' ':
          const item = flatItems[row];
          const loc = selectedLocations[col];
          if (item && loc) {
            const locData = item.locationData[loc.id];
            const qty = locData?.quantity || 0;
            if (qty > 0) {
              openQuantityPicker(item, loc.id, loc.name, qty);
            }
          }
          return current;
      }

      return { row, col };
    });
  }, [flatItems, selectedLocations, quantityPicker.open, openQuantityPicker, focusedCell, navigate]);

  const handleCellClick = async (
    item: StockItemData,
    locationId: number,
    locationName: string,
    availableQty: number
  ) => {
    openQuantityPicker(item, locationId, locationName, availableQty);
  };

  const handleAddToOrder = async () => {
    const qty = parseFloat(pickerQuantity);
    
    if (isNaN(qty) || qty === 0) {
      toast({
        title: "Invalid Quantity",
        description: "Please enter a non-zero quantity",
        variant: "destructive",
      });
      return;
    }

    const { stockItem, locationId, locationName, availableQty } = quantityPicker;
    
    if (!stockItem) return;

    const existingIdx = orderItems.findIndex(
      item => item.stockItemId === stockItem.id && item.sourceLocationId === locationId
    );

    const currentAllocated = existingIdx >= 0 ? orderItems[existingIdx].quantity : 0;
    const totalAfterAdd = currentAllocated + qty;

    if (totalAfterAdd < 0) {
      toast({
        title: "Invalid Quantity",
        description: `Cannot reduce below 0. Current order quantity is ${formatNumber(currentAllocated, 0)}.`,
        variant: "destructive",
      });
      return;
    }

    if (qty > 0 && totalAfterAdd > availableQty) {
      toast({
        title: "Exceeds Available Stock",
        description: `You can only add up to ${formatNumber(availableQty - currentAllocated, 0)} more units. Available: ${formatNumber(availableQty, 0)}, Already in order: ${formatNumber(currentAllocated, 0)}`,
        variant: "destructive",
      });
      return;
    }

    let updatedItems: OrderItem[];
    if (existingIdx >= 0) {
      updatedItems = [...orderItems];
      updatedItems[existingIdx] = {
        ...updatedItems[existingIdx],
        quantity: totalAfterAdd,
      };
    } else {
      const locationData = stockItem.locationData[locationId];
      updatedItems = [
        ...orderItems,
        {
          stockItemId: stockItem.id,
          stockItemName: stockItem.name,
          stockItemCode: stockItem.code,
          uom: stockItem.uom,
          sourceLocationId: locationId,
          sourceLocationName: locationName,
          quantity: qty,
          availableQty,
          rate: locationData?.rate || 0,
        },
      ];
    }

    setOrderItems(sortOrderItems(updatedItems));
    setQuantityPicker({ ...quantityPicker, open: false });
    toast({
      title: "Added to Order",
      description: `${formatNumber(qty, 0)} ${stockItem.uom} of ${stockItem.name} added`,
    });
  };

  const removeFromOrder = async (index: number) => {
    setOrderItems(orderItems.filter((_, i) => i !== index));
  };

  const validateOrder = (): string[] => {
    const errors: string[] = [];
    
    if (!destinationLocationId) {
      errors.push("Please select a destination location");
    }

    if (orderItems.length === 0) {
      errors.push("Order is empty. Please add items to transfer");
    }

    for (const item of orderItems) {
      if (item.quantity > item.availableQty) {
        errors.push(`${item.stockItemName} from ${item.sourceLocationName}: Requested ${formatNumber(item.quantity, 0)} but only ${formatNumber(item.availableQty, 0)} available`);
      }
      if (item.sourceLocationId === destinationLocationId) {
        errors.push(`${item.stockItemName}: Source and destination cannot be the same location`);
      }
    }

    return errors;
  };

  const handleValidate = async () => {
    const errors = validateOrder();
    setValidationErrors(errors);
    
    if (errors.length === 0) {
      toast({
        title: "Validation Passed",
        description: "Order is ready to process",
      });
    } else {
      toast({
        title: "Validation Failed",
        description: `Found ${errors.length} issue(s) that need to be fixed`,
        variant: "destructive",
      });
    }
  };

  const handleExportOrder = async (includeCost: boolean) => {
    if (orderItems.length === 0) {
      toast({
        title: "No data to export",
        description: "Add items to the order before exporting.",
        variant: "destructive",
      });
      return;
    }

    const destLocation = locations.find(l => l.id === destinationLocationId);
    const exportDate = format(transferDate, "M/d/yy");
    const companyName = selectedCompany?.name || "ETS";
    const destName = destLocation?.name || "";

    // Group order items by source location (preserve insertion order)
    const locationGroupMap = new Map<number, { locationName: string; items: typeof orderItems }>();
    for (const item of orderItems) {
      if (!locationGroupMap.has(item.sourceLocationId)) {
        locationGroupMap.set(item.sourceLocationId, { locationName: item.sourceLocationName, items: [] });
      }
      locationGroupMap.get(item.sourceLocationId)!.items.push(item);
    }
    const locationGroups = Array.from(locationGroupMap.entries()).map(([id, g]) => ({ locationId: id, ...g }));

    const numCols = includeCost ? 5 : 3;
    const lastColLetter = includeCost ? "E" : "C";

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Truck Trip");

    // ── Print / page setup ───────────────────────────────────────────────────
    ws.pageSetup = {
      paperSize: 9,            // A4
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,          // grow vertically as needed
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    } as ExcelJS.PageSetup;

    // Column widths sized for A4 portrait
    ws.columns = [
      { width: 46 },
      { width: 20 },
      { width: 14 },
      ...(includeCost ? [{ width: 14 }, { width: 16 }] : []),
    ];

    // Color palette
    const OLIVE_BG   = "FF6B7A2C";
    const COL_HDR_BG = "FFD4E89E";
    const SUB_BG     = "FFC6EFCE";
    const WHITE      = "FFFFFFFF";
    const BLACK      = "FF000000";
    const RED        = "FFCC0000";

    const thinBorder: Partial<ExcelJS.Borders> = {
      top:    { style: "thin", color: { argb: "FFB0B0B0" } },
      left:   { style: "thin", color: { argb: "FFB0B0B0" } },
      bottom: { style: "thin", color: { argb: "FFB0B0B0" } },
      right:  { style: "thin", color: { argb: "FFB0B0B0" } },
    };

    const applyBorder = (row: ExcelJS.Row, cols: number) => {
      for (let c = 1; c <= cols; c++) row.getCell(c).border = thinBorder;
    };

    // ── Row 1: Company name banner ──────────────────────────────────────────
    const row1 = ws.addRow([companyName, ...Array(numCols - 1).fill("")]);
    row1.height = 42;
    ws.mergeCells(`A1:${lastColLetter}1`);
    const r1c1 = row1.getCell(1);
    r1c1.value = companyName;
    r1c1.font = { bold: true, size: 20, color: { argb: WHITE } };
    r1c1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: OLIVE_BG } };
    r1c1.alignment = { horizontal: "center", vertical: "middle" };
    r1c1.border = thinBorder;

    // ── Row 2: TRUCK TRIP | DESTINATION: | destName ─────────────────────────
    const row2 = ws.addRow(["TRUCK TRIP", "DESTINATION:", destName, ...(includeCost ? ["", ""] : [])]);
    row2.height = 26;
    if (numCols > 3) ws.mergeCells(`A2:A3`);   // TRUCK TRIP spans rows 2+3
    const r2c1 = row2.getCell(1);
    r2c1.font = { bold: true, size: 16 };
    r2c1.alignment = { horizontal: "center", vertical: "middle" };
    r2c1.border = thinBorder;
    const r2c2 = row2.getCell(2);
    r2c2.font = { bold: true, size: 12 };
    r2c2.alignment = { horizontal: "right", vertical: "middle" };
    r2c2.border = thinBorder;
    const r2c3 = row2.getCell(3);
    r2c3.font = { bold: true, size: 12 };
    r2c3.alignment = { horizontal: "center", vertical: "middle" };
    r2c3.border = thinBorder;
    if (includeCost) {
      row2.getCell(4).border = thinBorder;
      row2.getCell(5).border = thinBorder;
    }

    // ── Row 3: (blank) | DATE: | date ───────────────────────────────────────
    const row3 = ws.addRow(["", "DATE :", exportDate, ...(includeCost ? ["", ""] : [])]);
    row3.height = 22;
    if (numCols === 3) {
      row3.getCell(1).border = thinBorder;
    }
    const r3c2 = row3.getCell(2);
    r3c2.font = { bold: true, size: 12 };
    r3c2.alignment = { horizontal: "right", vertical: "middle" };
    r3c2.border = thinBorder;
    const r3c3 = row3.getCell(3);
    r3c3.font = { bold: true, size: 12 };
    r3c3.alignment = { horizontal: "center", vertical: "middle" };
    r3c3.border = thinBorder;
    if (includeCost) {
      row3.getCell(4).border = thinBorder;
      row3.getCell(5).border = thinBorder;
    }

    // When 3 cols: merge A2:A3 so TRUCK TRIP spans both header rows
    if (numCols === 3) ws.mergeCells("A2:A3");

    // ── Row 4: Column headers ────────────────────────────────────────────────
    const colHeaders = [
      "ITEM  NAME",
      "LOCATION",
      "Quantity",
      ...(includeCost ? ["Rate", "Amount"] : []),
    ];
    const row4 = ws.addRow(colHeaders);
    row4.height = 22;
    for (let c = 1; c <= numCols; c++) {
      const cell = row4.getCell(c);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COL_HDR_BG } };
      cell.font = { bold: true, size: 12, color: { argb: BLACK } };
      cell.alignment = { horizontal: c === 1 ? "left" : "center", vertical: "middle" };
      cell.border = thinBorder;
    }

    // ── Data rows grouped by location ───────────────────────────────────────
    for (const group of locationGroups) {
      for (const item of group.items) {
        const vals: (string | number)[] = [
          item.stockItemName,
          item.sourceLocationName,
          item.quantity,
          ...(includeCost ? [item.rate, item.quantity * item.rate] : []),
        ];
        const dataRow = ws.addRow(vals);
        dataRow.height = 22;
        dataRow.getCell(1).font = { size: 12 };
        dataRow.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
        dataRow.getCell(2).font = { size: 12 };
        dataRow.getCell(2).alignment = { horizontal: "center", vertical: "middle" };
        dataRow.getCell(3).font = { size: 12 };
        dataRow.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
        if (includeCost) {
          dataRow.getCell(4).font = { size: 12 };
          dataRow.getCell(4).numFmt = "#,##0.00";
          dataRow.getCell(4).alignment = { horizontal: "right", vertical: "middle" };
          dataRow.getCell(5).font = { size: 12 };
          dataRow.getCell(5).numFmt = "#,##0.00";
          dataRow.getCell(5).alignment = { horizontal: "right", vertical: "middle" };
        }
        applyBorder(dataRow, numCols);
      }

      // Subtotal row for this group
      const groupQty = group.items.reduce((s, i) => s + i.quantity, 0);
      const groupAmt = group.items.reduce((s, i) => s + i.quantity * i.rate, 0);
      const subtotalVals: (string | number)[] = [
        `TOTAL ${group.locationName.toUpperCase()}`,
        "",
        groupQty,
        ...(includeCost ? ["", groupAmt] : []),
      ];
      const subRow = ws.addRow(subtotalVals);
      subRow.height = 24;
      ws.mergeCells(`A${subRow.number}:B${subRow.number}`);
      for (let c = 1; c <= numCols; c++) {
        const cell = subRow.getCell(c);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUB_BG } };
        cell.font = { bold: true, size: 12, color: { argb: BLACK } };
        cell.border = thinBorder;
      }
      subRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      subRow.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
      if (includeCost) {
        subRow.getCell(5).numFmt = "#,##0.00";
        subRow.getCell(5).alignment = { horizontal: "right", vertical: "middle" };
      }
    }

    // ── Grand total row ──────────────────────────────────────────────────────
    const grandQty = orderItems.reduce((s, i) => s + i.quantity, 0);
    const grandAmt = orderItems.reduce((s, i) => s + i.quantity * i.rate, 0);
    const grandVals: (string | number)[] = [
      "TOTAL",
      "",
      grandQty,
      ...(includeCost ? ["", grandAmt] : []),
    ];
    const grandRow = ws.addRow(grandVals);
    grandRow.height = 26;
    ws.mergeCells(`A${grandRow.number}:B${grandRow.number}`);
    for (let c = 1; c <= numCols; c++) {
      const cell = grandRow.getCell(c);
      cell.font = { bold: true, size: 14, color: { argb: RED } };
      cell.border = thinBorder;
    }
    grandRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    grandRow.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
    if (includeCost) {
      grandRow.getCell(5).numFmt = "#,##0.00";
      grandRow.getCell(5).alignment = { horizontal: "right", vertical: "middle" };
    }

    const safeDestName = destName.replace(/[/\\?%*:|"<>]/g, "_");
    const fileName = `Truck_Trip_${safeDestName}_${format(transferDate, "yyyy-MM-dd")}.xlsx`;
    await writeFile(workbook, fileName);
    toast({
      title: "Export successful",
      description: `Downloaded ${fileName} with ${orderItems.length} items.`,
    });
  };

  const processOrderMutation = useMutation({
    mutationFn: async (data: { orderItems: OrderItem[]; destinationLocationId: number; voucherDate: string; optional: boolean }) => {
      if (editVoucherId && existingTransfer?.id) {
        await apiRequest("PATCH", `/api/vouchers/${editVoucherId}`, {
          voucherDate: data.voucherDate,
          optional: data.optional,
        });
        const response = await apiRequest("PUT", `/api/stock-transfers/${existingTransfer.id}`, {
          destinationLocationId: data.destinationLocationId,
          notes: `Stock Transfer Order - ${data.orderItems.length} items`,
          items: data.orderItems.map(item => ({
            stockItemId: item.stockItemId,
            sourceLocationId: item.sourceLocationId,
            quantity: item.quantity,
            rate: item.rate,
          })),
        });
        return response.json();
      } else {
        const response = await apiRequest("POST", "/api/stock-transfers", {
          destinationLocationId: data.destinationLocationId,
          notes: `Stock Transfer Order - ${data.orderItems.length} items`,
          voucherDate: data.voucherDate,
          optional: data.optional,
          items: data.orderItems.map(item => ({
            stockItemId: item.stockItemId,
            sourceLocationId: item.sourceLocationId,
            quantity: item.quantity.toString(),
          })),
        });
        return response.json();
      }
    },
    onSuccess: () => {
      localStorage.removeItem(DRAFT_KEY);
      setAutosaveStatus("idle");
      toast({
        title: editVoucherId ? "Order Updated" : "Order Processed",
        description: editVoucherId ? "Successfully updated stock transfer voucher" : "Successfully created stock transfer voucher",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers", editVoucherId] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-by-location"] });
      queryClient.invalidateQueries({ queryKey: ["/api/location-summary"] });
      if (editVoucherId) {
        navigate("/daybook");
      }
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to process order",
        variant: "destructive",
      });
    },
  });

  const computeRevisionItems = () => {
    if (!existingTransfer?.items) return [];
    type RevKey = string;
    const originalMap = new Map<RevKey, { qty: number; name: string; srcName: string; stockItemId: number; sourceLocationId: number | null }>();
    for (const item of existingTransfer.items) {
      const key: RevKey = `${item.stockItemId}-${item.sourceLocationId ?? "null"}`;
      const si = stockItems.find((s) => s.id === item.stockItemId);
      const sl = locations.find((l) => l.id === item.sourceLocationId);
      originalMap.set(key, {
        qty: parseFloat(item.quantity) || 0,
        name: si?.name || "",
        srcName: sl?.name || "",
        stockItemId: item.stockItemId,
        sourceLocationId: item.sourceLocationId ?? null,
      });
    }
    const currentMap = new Map<RevKey, OrderItem>();
    for (const item of orderItems) {
      const key: RevKey = `${item.stockItemId}-${item.sourceLocationId ?? "null"}`;
      currentMap.set(key, item);
    }
    const allKeys = new Set([...originalMap.keys(), ...currentMap.keys()]);
    const result: Array<{
      stockItemId: number; stockItemName: string;
      sourceLocationId: number | null; sourceLocationName: string;
      originalQuantity: number; delta: number; newQuantity: number;
    }> = [];
    for (const key of allKeys) {
      const orig = originalMap.get(key);
      const cur = currentMap.get(key);
      const origQty = orig?.qty ?? 0;
      const curQty = cur?.quantity ?? 0;
      const delta = curQty - origQty;
      if (Math.abs(delta) < 0.001) continue;
      result.push({
        stockItemId: cur?.stockItemId ?? orig?.stockItemId ?? 0,
        stockItemName: cur?.stockItemName || orig?.name || "",
        sourceLocationId: cur?.sourceLocationId ?? orig?.sourceLocationId ?? null,
        sourceLocationName: cur?.sourceLocationName || orig?.srcName || "",
        originalQuantity: origQty,
        delta,
        newQuantity: curQty,
      });
    }
    return result;
  };

  const downloadImportTemplate = async () => {
    const wb = utils.book_new();
    const ws = wb.addWorksheet("Transfer Import");
    ws.addRow(["Code", "Name", "Qty Change"]);
    ws.getRow(1).font = { bold: true };
    ws.getColumn(1).width = 16;
    ws.getColumn(2).width = 36;
    ws.getColumn(3).width = 14;
    ws.addRow(["ABC123", "Example Item", 10]);
    ws.addRow(["XYZ456", "Another Item", -5]);
    ws.getRow(2).font = { italic: true, color: { argb: "FF999999" } };
    ws.getRow(3).font = { italic: true, color: { argb: "FF999999" } };
    await writeFile(wb, "transfer_import_template.xlsx");
  };

  const handleImportFile = async (file: File) => {
    setImportLoading(true);
    try {
      const wb = await readFile(file);
      const ws = wb.getWorksheet(1);
      if (!ws) { toast({ title: "Error", description: "Could not read worksheet", variant: "destructive" }); return; }
      const rows = utils.sheet_to_json<{ Code?: any; Name?: any; "Qty Change"?: any; "Item Name"?: any; Change?: any; Qty?: any }>(ws);

      const preview: ImportPreviewRow[] = rows
        .filter(row => row.Code !== undefined || row.Name !== undefined || row["Item Name"] !== undefined)
        .map(row => {
          const code = String(row.Code ?? "").trim();
          const name = String(row.Name ?? row["Item Name"] ?? "").trim();
          const change = parseFloat(String(row["Qty Change"] ?? row.Change ?? row.Qty ?? "0")) || 0;

          let matched = code ? stockItems.find(s => s.code?.toLowerCase() === code.toLowerCase()) : undefined;
          if (!matched && name) matched = stockItems.find(s => s.name.toLowerCase() === name.toLowerCase());

          if (!matched) {
            return { rawCode: code, rawName: name, stockItemId: null, stockItemName: name || code || "Unknown", currentQty: 0, change, newQty: Math.max(0, change), sourceLocationId: null, sourceLocationName: "", status: "not_found" as const };
          }

          const currentQty = orderItems.filter(i => i.stockItemId === matched!.id).reduce((s, i) => s + i.quantity, 0);
          const newQty = currentQty + change;

          let srcLocId: number | null = null;
          let srcLocName = "";
          const existingOrderItem = orderItems.find(i => i.stockItemId === matched!.id);
          if (existingOrderItem) {
            srcLocId = existingOrderItem.sourceLocationId;
            srcLocName = existingOrderItem.sourceLocationName;
          } else if (summaryData) {
            let bestQty = 0;
            for (const group of summaryData.stockGroups) {
              const si = group.items.find(i => i.id === matched!.id);
              if (si) {
                for (const [locIdStr, locData] of Object.entries(si.locationData)) {
                  if (locData.quantity > bestQty) {
                    bestQty = locData.quantity;
                    srcLocId = parseInt(locIdStr);
                    srcLocName = locations.find(l => l.id === srcLocId)?.name || "";
                  }
                }
              }
            }
          }

          const status: ImportPreviewRow["status"] = newQty <= 0 ? "remove" : currentQty === 0 ? "new_item" : "ok";
          return { rawCode: code, rawName: name, stockItemId: matched.id, stockItemName: matched.name, currentQty, change, newQty: Math.max(0, newQty), sourceLocationId: srcLocId, sourceLocationName: srcLocName, status };
        });

      setImportPreview(preview);
    } catch (err: any) {
      toast({ title: "Parse Error", description: err.message || "Failed to read file", variant: "destructive" });
    } finally {
      setImportLoading(false);
    }
  };

  const applyImport = () => {
    const updated = [...orderItems];
    for (const row of importPreview) {
      if (row.status === "not_found") continue;
      const idx = updated.findIndex(i => i.stockItemId === row.stockItemId);
      if (idx >= 0) {
        const newQty = updated[idx].quantity + row.change;
        if (newQty <= 0) updated.splice(idx, 1);
        else updated[idx] = { ...updated[idx], quantity: newQty };
      } else if (row.stockItemId && row.newQty > 0 && row.sourceLocationId) {
        const si = stockItems.find(s => s.id === row.stockItemId)!;
        let availableQty = 0;
        if (summaryData) {
          for (const group of summaryData.stockGroups) {
            const sitem = group.items.find(i => i.id === row.stockItemId);
            if (sitem && sitem.locationData[row.sourceLocationId!]) availableQty = sitem.locationData[row.sourceLocationId!].quantity;
          }
        }
        updated.push({ stockItemId: row.stockItemId, stockItemName: row.stockItemName, stockItemCode: si?.code || "", uom: si?.uom || "", sourceLocationId: row.sourceLocationId, sourceLocationName: row.sourceLocationName, quantity: row.newQty, availableQty, rate: 0 });
      }
    }
    setOrderItems(updated);
    setImportDialogOpen(false);
    setImportPreview([]);
    toast({ title: "Import Applied", description: `${importPreview.filter(r => r.status !== "not_found").length} items updated` });
  };

  const exportPreviewExcel = async () => {
    const wb = utils.book_new();
    const ws = wb.addWorksheet("Transfer Order");
    ws.addRow(["Item Name", "Qty"]);
    ws.getRow(1).font = { bold: true };
    for (const row of importPreview.filter(r => r.newQty > 0 && r.status !== "not_found")) {
      ws.addRow([row.stockItemName, row.newQty]);
    }
    ws.getColumn(1).width = 36;
    ws.getColumn(2).width = 12;
    await writeFile(wb, "transfer_order_preview.xlsx");
  };

  const exportPreviewPDF = async () => {
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    doc.setFontSize(14);
    doc.text("Transfer Order Preview", 14, 18);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 25);
    const rows = importPreview.filter(r => r.newQty > 0 && r.status !== "not_found").map((r, i) => [i + 1, r.stockItemName, r.newQty]);
    autoTable(doc, { startY: 30, head: [["#", "Item Name", "Qty"]], body: rows, styles: { fontSize: 9 }, headStyles: { fillColor: [30, 30, 30] }, columnStyles: { 0: { cellWidth: 12 }, 2: { cellWidth: 20, halign: "right" } } });
    doc.save("transfer_order_preview.pdf");
  };

  const handleSaveAsRevision = async () => {
    const errors = validateOrder();
    if (errors.length > 0) {
      setValidationErrors(errors);
      toast({ title: "Cannot Save", description: "Please fix validation errors first", variant: "destructive" });
      return;
    }
    setRevisionDialogOpen(true);
  };

  const confirmSaveAsRevision = async () => {
    const revisionItems = computeRevisionItems();
    if (revisionItems.length === 0) {
      toast({ title: "No Changes", description: "No differences found compared to the saved order", variant: "destructive" });
      setRevisionDialogOpen(false);
      return;
    }
    if (!destinationLocationId || !existingTransfer?.id) return;

    setIsSavingRevision(true);
    try {
      await apiRequest("PATCH", `/api/vouchers/${editVoucherId}`, {
        voucherDate: format(transferDate, "yyyy-MM-dd"),
        optional: isOptional,
      });
      const nonZeroItems = orderItems.filter((item) => item.quantity > 0);
      if (nonZeroItems.length === 0) {
        toast({ title: "Cannot Save", description: "All items have been removed — cannot save an empty transfer as a revision", variant: "destructive" });
        setRevisionDialogOpen(false);
        setIsSavingRevision(false);
        return;
      }
      await apiRequest("PUT", `/api/stock-transfers/${existingTransfer.id}`, {
        destinationLocationId,
        notes: `Stock Transfer Order - ${nonZeroItems.length} items`,
        items: nonZeroItems.map((item) => ({
          stockItemId: item.stockItemId,
          sourceLocationId: item.sourceLocationId,
          quantity: item.quantity,
          rate: item.rate,
        })),
      });
      await apiRequest("POST", `/api/stock-transfers/${existingTransfer.id}/revisions`, {
        note: revisionNote.trim() || null,
        items: revisionItems,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers", editVoucherId] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers", existingTransfer.id, "revisions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-by-location"] });
      queryClient.invalidateQueries({ queryKey: ["/api/location-summary"] });
      setRevisionNote("");
      setRevisionDialogOpen(false);
      const nextRevNum = revisions.length + 1;
      toast({ title: "Revision Saved", description: `Rev ${nextRevNum} recorded and order updated` });
      navigate("/daybook");
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to save revision", variant: "destructive" });
    } finally {
      setIsSavingRevision(false);
    }
  };

  const handleProcessOrder = async () => {
    const errors = validateOrder();
    if (errors.length > 0) {
      setValidationErrors(errors);
      toast({
        title: "Cannot Process",
        description: "Please fix validation errors first",
        variant: "destructive",
      });
      return;
    }

    if (!destinationLocationId) return;

    setIsProcessing(true);
    try {
      await processOrderMutation.mutateAsync({
        orderItems,
        destinationLocationId,
        voucherDate: format(transferDate, "yyyy-MM-dd"),
        optional: isOptional,
      });
      if (!editVoucherId) {
        setOrderItems([]);
      }
      setValidationErrors([]);
    } finally {
      setIsProcessing(false);
    }
  };

  const totalBales = orderItems.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="space-y-4">
      {hasDraft && !editVoucherId && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-4 py-2 text-sm" data-testid="banner-draft-restore">
          <span className="text-amber-800 dark:text-amber-300">You have an unsaved draft. Restore it to continue where you left off.</span>
          <div className="flex gap-2 flex-shrink-0">
            <Button size="sm" variant="outline" onClick={discardDraft} data-testid="button-discard-draft">Discard</Button>
            <Button size="sm" onClick={restoreDraft} data-testid="button-restore-draft">Restore Draft</Button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <PageHeader title={editVoucherId ? "Edit Stock Transfer Order" : "Stock Transfer Order"} subtitle={editVoucherId ? "Edit and update this stock transfer using the order view" : "Build orders by selecting items from multiple source locations"} />
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label className="text-sm whitespace-nowrap">Destination:</Label>
            <Select
              value={destinationLocationId?.toString() || ""}
              onValueChange={(v) => setDestinationLocationId(parseInt(v))}
            >
              <SelectTrigger className="w-full sm:w-[200px]" data-testid="select-destination">
                <SelectValue placeholder="Choose destination" />
              </SelectTrigger>
              <SelectContent>
                {availableDestinations.map((loc) => (
                  <SelectItem 
                    key={loc.id} 
                    value={loc.id.toString()}
                    data-testid={`select-destination-option-${loc.id}`}
                  >
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <Dialog open={locationDialogOpen} onOpenChange={setLocationDialogOpen}>
            <Button 
              variant="outline" 
              onClick={() => setLocationDialogOpen(true)}
              data-testid="button-select-sources"
            >
              <Settings2 className="h-4 w-4 mr-2" />
              Source Locations ({selectedLocations.length})
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Select Source Locations</DialogTitle>
              </DialogHeader>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {locations.map((loc) => (
                  <div
                    key={loc.id}
                    className="flex items-center gap-3 p-2 rounded-md hover-elevate cursor-pointer"
                    onClick={() => toggleLocation(loc.id)}
                    data-testid={`location-checkbox-${loc.id}`}
                  >
                    <Checkbox
                      checked={selectedLocationIds.includes(loc.id)}
                      onCheckedChange={() => toggleLocation(loc.id)}
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{loc.name}</p>
                      <p className="text-xs text-muted-foreground">{loc.code}</p>
                    </div>
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button onClick={() => setLocationDialogOpen(false)}>Done</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full sm:w-[140px] justify-start text-left font-normal",
                  !transferDate && "text-muted-foreground"
                )}
                data-testid="button-select-date"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {transferDate ? format(transferDate, "MMM dd, yyyy") : "Pick date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={transferDate}
                onSelect={(date) => date && setTransferDate(date)}
                initialFocus
              />
            </PopoverContent>
          </Popover>
          
          <div className="flex items-center gap-2">
            <Switch
              id="optional-mode"
              checked={isOptional}
              onCheckedChange={setIsOptional}
              data-testid="switch-optional"
            />
            <Label htmlFor="optional-mode" className="text-sm cursor-pointer">
              Optional
            </Label>
          </div>

          {editVoucherId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/vouchers?edit=${editVoucherId}&tab=transfer`)}
              data-testid="button-switch-to-normal-view"
            >
              <List className="h-4 w-4 mr-2" />
              Normal View
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={orderItems.length === 0}
                data-testid="button-export-order"
              >
                <FileDown className="h-4 w-4 mr-1" />
                Export
                <ChevronDown className="h-4 w-4 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExportOrder(false)} data-testid="export-order-no-cost">
                Export without Cost
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportOrder(true)} data-testid="export-order-with-cost">
                Export with Cost
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {validationErrors.length > 0 && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="py-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium text-destructive">Validation Errors</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {validationErrors.map((error, idx) => (
                    <li key={idx}>{error}</li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col lg:flex-row gap-4">
        <Card className="lg:flex-[3]">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                <CardTitle className="text-base">Inventory Matrix</CardTitle>
              </div>
              <p className="text-xs text-muted-foreground">Click to focus, then use arrow keys + spacebar to add / Enter to view history</p>
            </div>
          </CardHeader>
          <CardContent>
            {selectedLocations.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <MapPin className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>Select source locations to view inventory</p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => setLocationDialogOpen(true)}
                >
                  Select Locations
                </Button>
              </div>
            ) : isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <div 
                ref={matrixRef}
                tabIndex={0}
                onKeyDown={handleMatrixKeyDown}
                className="overflow-auto max-h-[500px] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-md border"
              >
                <table className="w-full caption-bottom text-sm border-collapse">
                  <thead className="[&_tr]:border-b sticky top-0 z-30">
                    <tr className="border-b">
                      <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground min-w-[200px] sticky top-0 left-0 bg-muted z-50 border-r shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
                        Item
                      </th>
                      {selectedLocations.map((loc) => (
                        <th
                          key={loc.id}
                          className="h-12 px-4 text-center align-middle font-medium text-muted-foreground min-w-[100px] sticky top-0 bg-muted z-40"
                        >
                          {loc.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="[&_tr:last-child]:border-0">
                    {summaryData?.stockGroups.map((group) => (
                      <Fragment key={group.id}>
                        <tr
                          className="border-b transition-colors cursor-pointer hover-elevate bg-muted/50"
                          onClick={() => toggleGroup(group.id)}
                          data-testid={`group-row-${group.id}`}
                        >
                          <td className="p-4 align-middle font-medium sticky left-0 bg-muted/50 z-20 border-r shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
                            <div className="flex items-center gap-2">
                              {expandedGroups.has(group.id) ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                              {group.name}
                              <Badge variant="secondary" className="text-xs">
                                {group.items.length}
                              </Badge>
                            </div>
                          </td>
                          {selectedLocations.map((loc) => {
                            const locData = group.locationData[loc.id];
                            const qty = locData?.quantity || 0;
                            return (
                              <td key={loc.id} className="p-4 align-middle text-center font-mono text-sm">
                                {qty > 0 ? formatNumber(qty, 0) : "-"}
                              </td>
                            );
                          })}
                        </tr>

                        {expandedGroups.has(group.id) &&
                          [...group.items]
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((item) => {
                              const flatRowIndex = flatItems.findIndex(fi => fi.id === item.id);
                              return (
                              <tr key={item.id} data-testid={`item-row-${item.id}`} className="border-b transition-colors hover:bg-muted/50 bg-background">
                                <td className="p-4 align-middle pl-8 sticky left-0 bg-background z-20 border-r shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
                                  <p className="text-sm">{item.name}</p>
                                </td>
                                {selectedLocations.map((loc, colIndex) => {
                                  const locData = item.locationData[loc.id];
                                  const qty = locData?.quantity || 0;
                                  const hasStock = qty > 0;
                                  const isFocused = focusedCell?.row === flatRowIndex && focusedCell?.col === colIndex;
                                  
                                  return (
                                    <td key={loc.id} className="p-1 align-middle" data-focused={isFocused ? "true" : undefined}>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className={cn(
                                          "w-full font-mono",
                                          hasStock && "hover:bg-primary/10 cursor-pointer",
                                          isFocused && "ring-2 ring-primary ring-offset-1"
                                        )}
                                        disabled={!hasStock}
                                        onClick={() => {
                                          setFocusedCell({ row: flatRowIndex, col: colIndex });
                                          handleCellClick(item, loc.id, loc.name, qty);
                                        }}
                                        data-testid={`cell-item-${item.id}-loc-${loc.id}`}
                                      >
                                        {hasStock ? formatNumber(qty, 0) : "-"}
                                      </Button>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                            })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex-1 flex flex-col gap-4 lg:min-w-[300px]">
          {destinationLocationId && (
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="py-3">
                <div className="flex items-center gap-2 text-sm">
                  <ArrowRight className="h-4 w-4 text-primary" />
                  <span className="text-muted-foreground">Sending to:</span>
                  <span className="font-medium">
                    {locations.find(l => l.id === destinationLocationId)?.name}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
          
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Transfer Order</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{orderItems.length} items</Badge>
                  <Badge variant="default" className="font-mono">
                    {formatNumber(totalBales, 0)} bales
                  </Badge>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => { setImportPreview([]); setImportDialogOpen(true); }}
                    data-testid="button-open-import"
                    title="Import from Excel"
                  >
                    <Upload className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {orderItems.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Click on quantities or use arrow keys + spacebar to add / Enter to view history</p>
                </div>
              ) : (
                <>
                  <ScrollArea className="h-[300px]">
                    <div className="space-y-2">
                      {orderItems.map((item, index) => (
                        <div
                          key={`${item.stockItemId}-${item.sourceLocationId}`}
                          className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50"
                          data-testid={`order-item-${index}`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.stockItemName}</p>
                            <p className="text-xs text-muted-foreground">
                              From: {item.sourceLocationName} | {formatNumber(item.quantity, 0)} {item.uom}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeFromOrder(index)}
                            data-testid={`button-remove-order-item-${index}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                  
                  <div className="pt-2 border-t space-y-3">
                    <div className="flex justify-between text-sm font-medium">
                      <span>Total Bales:</span>
                      <span className="font-mono text-lg">{formatNumber(totalBales, 0)}</span>
                    </div>
                    
                    {!editVoucherId && autosaveStatus !== "idle" && (
                      <p className={`text-xs text-center ${autosaveStatus === "saved" ? "text-green-600 dark:text-green-400" : autosaveStatus === "failed" ? "text-destructive" : "text-muted-foreground"}`} data-testid="text-autosave-status">
                        {autosaveStatus === "saving" ? "Saving draft..." : autosaveStatus === "saved" ? "Draft saved" : "Draft save failed"}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleValidate}
                        className="flex-1"
                        data-testid="button-validate-order"
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Validate
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleProcessOrder}
                        disabled={isProcessing || !destinationLocationId}
                        className="flex-1"
                        data-testid="button-process-order"
                      >
                        {isProcessing ? (editVoucherId ? "Updating..." : "Processing...") : (editVoucherId ? "Update Order" : "Process")}
                      </Button>
                    </div>
                    {editVoucherId && existingTransfer?.id && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleSaveAsRevision}
                        disabled={isSavingRevision || !destinationLocationId}
                        className="w-full"
                        data-testid="button-save-as-revision"
                      >
                        <GitBranch className="h-4 w-4 mr-1" />
                        Save as Revision
                      </Button>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Revision History Panel (edit mode only) ── */}
      {editVoucherId && existingTransfer?.id && (
        <Card>
          <CardHeader
            className="p-4 sm:p-5 cursor-pointer select-none"
            onClick={() => setRevisionsExpanded((v) => !v)}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">Revision History</CardTitle>
                {revisions.length > 0 && (
                  <Badge variant="secondary" className="ml-1">{revisions.length}</Badge>
                )}
              </div>
              {revisionsExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </CardHeader>
          {revisionsExpanded && (
            <CardContent className="pt-0 space-y-4">
              {revisions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No revisions yet. Use "Save as Revision" to record tracked changes.</p>
              ) : (
                revisions.map((rev: any) => (
                  <div key={rev.id} className="border rounded-md overflow-hidden">
                    <div className="flex items-center justify-between gap-3 p-3 bg-muted/40 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={rev.optional ? "secondary" : "default"}>
                          Rev {rev.revisionNumber}
                        </Badge>
                        {rev.optional && <Badge variant="outline" className="text-xs">Reference Only</Badge>}
                        <span className="text-xs text-muted-foreground">
                          {rev.revisionDate ? new Date(rev.revisionDate).toLocaleDateString() : ""}
                        </span>
                        {rev.note && <span className="text-xs italic text-muted-foreground">"{rev.note}"</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground">Reference only:</span>
                          <Switch
                            checked={rev.optional}
                            onCheckedChange={async (checked) => {
                              await apiRequest("PATCH", `/api/stock-transfer-revisions/${rev.id}/optional`, { optional: checked });
                              queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers", existingTransfer.id, "revisions"] });
                            }}
                            data-testid={`switch-revision-optional-${rev.id}`}
                          />
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={async () => {
                            if (!window.confirm(`Delete Rev ${rev.revisionNumber}? This cannot be undone.`)) return;
                            await apiRequest("DELETE", `/api/stock-transfer-revisions/${rev.id}`);
                            queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers", existingTransfer.id, "revisions"] });
                          }}
                          data-testid={`button-delete-revision-${rev.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {rev.items && rev.items.length > 0 && (
                      <div className="table-responsive">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/30">
                            <tr>
                              <th className="text-left p-2 font-medium">Item</th>
                              <th className="text-left p-2 font-medium hidden sm:table-cell">From</th>
                              <th className="text-right p-2 font-medium">Was</th>
                              <th className="text-right p-2 font-medium">Change</th>
                              <th className="text-right p-2 font-medium">Now</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rev.items.map((item: any, idx: number) => {
                              const delta = parseFloat(item.delta);
                              return (
                                <tr key={idx} className="border-t">
                                  <td className="p-2 font-medium">{item.stockItemName}</td>
                                  <td className="p-2 text-muted-foreground hidden sm:table-cell">{item.sourceLocationName || "—"}</td>
                                  <td className="p-2 text-right font-mono text-muted-foreground">{formatNumber(parseFloat(item.originalQuantity), 0)}</td>
                                  <td className={`p-2 text-right font-mono font-semibold ${delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                                    {delta > 0 ? "+" : ""}{formatNumber(delta, 0)}
                                  </td>
                                  <td className="p-2 text-right font-mono font-semibold">{formatNumber(parseFloat(item.newQuantity), 0)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          )}
        </Card>
      )}

      {/* ── Revision Note Dialog ── */}
      <Dialog open={revisionDialogOpen} onOpenChange={setRevisionDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              Save as Revision
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will update the order <strong>and</strong> record the changes as{" "}
              <strong>Rev {revisions.length + 1}</strong>.
            </p>
            {(() => {
              const items = computeRevisionItems();
              return items.length === 0 ? (
                <p className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-md px-3 py-2">
                  No differences detected compared to the saved order.
                </p>
              ) : (
                <div className="border rounded-md overflow-hidden text-sm">
                  <table className="w-full">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2 font-medium">Item</th>
                        <th className="text-right p-2 font-medium">Was</th>
                        <th className="text-right p-2 font-medium">Change</th>
                        <th className="text-right p-2 font-medium">Now</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="p-2 font-medium truncate max-w-[120px]">{item.stockItemName}</td>
                          <td className="p-2 text-right font-mono text-muted-foreground">{formatNumber(item.originalQuantity, 0)}</td>
                          <td className={`p-2 text-right font-mono font-semibold ${item.delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                            {item.delta > 0 ? "+" : ""}{formatNumber(item.delta, 0)}
                          </td>
                          <td className="p-2 text-right font-mono">{formatNumber(item.newQuantity, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
            <div className="space-y-1.5">
              <Label htmlFor="revision-note">Note (optional)</Label>
              <Textarea
                id="revision-note"
                placeholder="Why was this revised? e.g. Shop sold 10 bales of fabric"
                value={revisionNote}
                onChange={(e) => setRevisionNote(e.target.value)}
                rows={2}
                data-testid="input-revision-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevisionDialogOpen(false)} disabled={isSavingRevision}>
              Cancel
            </Button>
            <Button
              onClick={confirmSaveAsRevision}
              disabled={isSavingRevision || computeRevisionItems().length === 0}
              data-testid="button-confirm-revision"
            >
              {isSavingRevision ? "Saving..." : "Save Revision"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Excel Import Dialog ── */}
      <Dialog open={importDialogOpen} onOpenChange={(o) => { setImportDialogOpen(o); if (!o) setImportPreview([]); }}>
        <DialogContent className="sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              Import from Excel
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {importPreview.length === 0 ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Upload an Excel file with columns: <strong>Code</strong>, <strong>Name</strong>, <strong>Qty Change</strong>.
                  Use positive values to add and negative to reduce.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={downloadImportTemplate} data-testid="button-download-template">
                    <FileDown className="h-4 w-4 mr-1" />
                    Download Template
                  </Button>
                </div>
                <label
                  className="flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-md p-8 cursor-pointer hover-elevate text-muted-foreground"
                  data-testid="label-import-dropzone"
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleImportFile(f); }}
                >
                  <input
                    ref={importFileRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    data-testid="input-import-file"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ""; }}
                  />
                  <Upload className="h-8 w-8 opacity-40" />
                  <span className="text-sm font-medium">{importLoading ? "Parsing..." : "Click or drag & drop Excel file"}</span>
                  <span className="text-xs">.xlsx / .xls supported</span>
                </label>
                {importLoading && <p className="text-sm text-center text-muted-foreground">Reading file…</p>}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex gap-2 text-xs">
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">{importPreview.filter(r => r.status === 'ok' || r.status === 'new_item').length} to update</span>
                    {importPreview.filter(r => r.status === 'remove').length > 0 && <span className="text-destructive font-medium">{importPreview.filter(r => r.status === 'remove').length} to remove</span>}
                    {importPreview.filter(r => r.status === 'not_found').length > 0 && <span className="text-muted-foreground">{importPreview.filter(r => r.status === 'not_found').length} unmatched</span>}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={exportPreviewExcel} data-testid="button-export-preview-excel">
                      <FileDown className="h-3 w-3 mr-1" />
                      Excel
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportPreviewPDF} data-testid="button-export-preview-pdf">
                      <FileDown className="h-3 w-3 mr-1" />
                      PDF
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { setImportPreview([]); if (importFileRef.current) importFileRef.current.value = ""; }} data-testid="button-clear-import">
                      Clear
                    </Button>
                  </div>
                </div>

                <div className="border rounded-md overflow-hidden text-sm">
                  <div className="max-h-[340px] overflow-y-auto">
                    <table className="w-full">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="text-left p-2 font-medium">Item</th>
                          <th className="text-right p-2 font-medium">Current</th>
                          <th className="text-right p-2 font-medium">Change</th>
                          <th className="text-right p-2 font-medium">New Qty</th>
                          <th className="p-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.map((row, idx) => (
                          <tr key={idx} className={cn("border-t", row.status === 'not_found' && "opacity-50")}>
                            <td className="p-2">
                              <p className="font-medium truncate max-w-[220px]">{row.stockItemName}</p>
                              {row.status === 'new_item' && <p className="text-xs text-emerald-600 dark:text-emerald-400">New — from {row.sourceLocationName || "?"}</p>}
                              {row.status === 'not_found' && <p className="text-xs text-destructive">Not found — skipped</p>}
                              {row.status === 'remove' && <p className="text-xs text-destructive">Will be removed from order</p>}
                            </td>
                            <td className="p-2 text-right font-mono text-muted-foreground">{formatNumber(row.currentQty, 0)}</td>
                            <td className={cn("p-2 text-right font-mono font-semibold", row.change > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                              <span className="inline-flex items-center gap-0.5">
                                {row.change > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                {row.change > 0 ? "+" : ""}{formatNumber(row.change, 0)}
                              </span>
                            </td>
                            <td className="p-2 text-right font-mono font-semibold">{row.status !== 'not_found' ? formatNumber(row.newQty, 0) : "—"}</td>
                            <td className="p-2 text-center">
                              {row.status === 'ok' && <Check className="h-4 w-4 text-emerald-500 mx-auto" />}
                              {row.status === 'new_item' && <span className="text-xs bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded-full">+New</span>}
                              {row.status === 'remove' && <AlertCircle className="h-4 w-4 text-destructive mx-auto" />}
                              {row.status === 'not_found' && <AlertCircle className="h-4 w-4 text-muted-foreground mx-auto" />}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setImportDialogOpen(false); setImportPreview([]); }} data-testid="button-cancel-import">
              Cancel
            </Button>
            {importPreview.length > 0 && (
              <Button
                onClick={applyImport}
                disabled={importPreview.every(r => r.status === 'not_found')}
                data-testid="button-apply-import"
              >
                Apply to Order
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={quantityPicker.open}
        onOpenChange={(open) => setQuantityPicker({ ...quantityPicker, open })}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Add to Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-md">
              <p className="font-medium">{quantityPicker.stockItem?.name}</p>
              <p className="text-sm text-muted-foreground">
                From: {quantityPicker.locationName}
              </p>
              <p className="text-sm text-muted-foreground">
                Available: <span className="font-mono">{formatNumber(quantityPicker.availableQty, 0)}</span>{" "}
                {quantityPicker.stockItem?.uom}
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="picker-quantity">
                Quantity{editVoucherId ? <span className="text-muted-foreground font-normal ml-1 text-xs">(negative = reduce, e.g. -1)</span> : ""}
              </Label>
              <Input
                id="picker-quantity"
                ref={quantityInputRef}
                type="number"
                step="0.001"
                value={pickerQuantity}
                onChange={(e) => setPickerQuantity(e.target.value)}
                placeholder={editVoucherId ? "e.g. -1 to reduce" : "Enter quantity"}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleAddToOrder();
                  }
                }}
                data-testid="input-picker-quantity"
              />
              {parseFloat(pickerQuantity) > quantityPicker.availableQty && parseFloat(pickerQuantity) > 0 && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Exceeds available stock
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setQuantityPicker({ ...quantityPicker, open: false })}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddToOrder}
              disabled={
                !pickerQuantity ||
                parseFloat(pickerQuantity) === 0 ||
                isNaN(parseFloat(pickerQuantity)) ||
                (parseFloat(pickerQuantity) > 0 && parseFloat(pickerQuantity) > quantityPicker.availableQty)
              }
              data-testid="button-confirm-add"
            >
              {parseFloat(pickerQuantity) < 0 ? "Reduce Qty" : "Add to Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stock Movement History Dialog */}
      <Dialog
        open={historyDialogOpen}
        onOpenChange={(open) => {
          setHistoryDialogOpen(open);
          if (!open) {
            setTimeout(() => matrixRef.current?.focus(), 50);
          }
        }}
      >
        <DialogContent className="max-w-4xl flex flex-col" style={{ maxHeight: "80vh" }}>
          <DialogHeader>
            <DialogTitle>Stock Movement — {historyItem?.name}</DialogTitle>
            <DialogDescription className="flex items-center gap-1.5 text-sm">
              <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
              {historyLocation?.name}
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-end flex-shrink-0 pb-1">
            <PeriodFilter value={historyPeriod} onChange={setHistoryPeriod} />
          </div>

          <div className="flex-1 overflow-auto min-h-0 border rounded-md">
            {historyLoading ? (
              <div className="space-y-2 p-4">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : !historyData?.monthlyData?.some(
                (m: any) => m.inwardQty > 0 || m.outwardQty > 0 || m.openingQty !== 0 || m.closingQty !== 0
              ) ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                No stock movement for this period
              </div>
            ) : (
              <table className="w-full text-sm border-collapse" style={{ minWidth: "700px" }}>
                <thead className="sticky top-0 z-10">
                  <tr className="bg-muted border-b">
                    <th rowSpan={2} className="text-left align-bottom px-3 py-2 border-r font-semibold w-28">Month</th>
                    <th colSpan={3} className="text-center px-2 py-1.5 border-r font-semibold text-muted-foreground">Opening</th>
                    <th colSpan={3} className="text-center px-2 py-1.5 border-r font-semibold text-green-700 dark:text-green-400">Stock In</th>
                    <th colSpan={3} className="text-center px-2 py-1.5 border-r font-semibold text-red-700 dark:text-red-400">Stock Out</th>
                    <th colSpan={3} className="text-center px-2 py-1.5 font-semibold text-primary">Closing</th>
                  </tr>
                  <tr className="bg-muted/70 border-b text-xs">
                    <th className="text-right px-3 py-1.5 font-medium text-muted-foreground border-r">Qty</th>
                    <th className="text-right px-3 py-1.5 font-medium text-muted-foreground border-r">Rate</th>
                    <th className="text-right px-3 py-1.5 font-medium text-muted-foreground border-r">Value</th>
                    <th className="text-right px-3 py-1.5 font-medium border-r text-green-700 dark:text-green-400">Qty</th>
                    <th className="text-right px-3 py-1.5 font-medium border-r text-green-700 dark:text-green-400">Rate</th>
                    <th className="text-right px-3 py-1.5 font-medium border-r text-green-700 dark:text-green-400">Value</th>
                    <th className="text-right px-3 py-1.5 font-medium border-r text-red-700 dark:text-red-400">Qty</th>
                    <th className="text-right px-3 py-1.5 font-medium border-r text-red-700 dark:text-red-400">Rate</th>
                    <th className="text-right px-3 py-1.5 font-medium border-r text-red-700 dark:text-red-400">Value</th>
                    <th className="text-right px-3 py-1.5 font-medium text-primary">Qty</th>
                    <th className="text-right px-3 py-1.5 font-medium text-primary">Rate</th>
                    <th className="text-right px-3 py-1.5 font-medium text-primary">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {(historyData?.monthlyData ?? []).map((month: any) => {
                    const isActive = month.inwardQty > 0 || month.outwardQty > 0 || month.openingQty !== 0 || month.closingQty !== 0;
                    const fmtQty = (n: number) => n === 0 ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
                    const fmtRate = (n: number) => n === 0 ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    const fmtVal = (n: number) => n === 0 ? "—" : formatAmount(n);
                    return (
                      <tr key={month.month} className={`border-b transition-colors ${isActive ? "" : "text-muted-foreground/50"}`}>
                        <td className="font-medium px-3 py-2 border-r">{month.monthName}</td>
                        <td className="text-right px-3 py-2 tabular-nums border-r text-muted-foreground">{fmtQty(month.openingQty)}</td>
                        <td className="text-right px-3 py-2 tabular-nums border-r text-muted-foreground">{fmtRate(month.openingRate)}</td>
                        <td className="text-right px-3 py-2 tabular-nums border-r text-muted-foreground">{fmtVal(month.openingValue)}</td>
                        <td
                          className={`text-right px-3 py-2 tabular-nums border-r text-green-700 dark:text-green-400 font-medium ${month.inwardQty > 0 ? "cursor-pointer underline underline-offset-2 decoration-dotted hover:text-green-900 dark:hover:text-green-200" : ""}`}
                          onClick={() => {
                            if (month.inwardQty > 0) {
                              setDetailYear(parseInt(historyPeriod.fromDate.slice(0, 4)));
                              setDetailMonth(month.month);
                              setDetailMonthName(month.monthName);
                              setDetailDirection("in");
                              setDetailOpen(true);
                            }
                          }}
                          title={month.inwardQty > 0 ? "Click to see individual transactions" : undefined}
                        >{fmtQty(month.inwardQty)}</td>
                        <td className="text-right px-3 py-2 tabular-nums border-r text-green-700 dark:text-green-400">{fmtRate(month.inwardRate)}</td>
                        <td className="text-right px-3 py-2 tabular-nums border-r text-green-700 dark:text-green-400">{fmtVal(month.inwardValue)}</td>
                        <td
                          className={`text-right px-3 py-2 tabular-nums border-r text-red-700 dark:text-red-400 font-medium ${month.outwardQty > 0 ? "cursor-pointer underline underline-offset-2 decoration-dotted hover:text-red-900 dark:hover:text-red-200" : ""}`}
                          onClick={() => {
                            if (month.outwardQty > 0) {
                              setDetailYear(parseInt(historyPeriod.fromDate.slice(0, 4)));
                              setDetailMonth(month.month);
                              setDetailMonthName(month.monthName);
                              setDetailDirection("out");
                              setDetailOpen(true);
                            }
                          }}
                          title={month.outwardQty > 0 ? "Click to see individual transactions" : undefined}
                        >{fmtQty(month.outwardQty)}</td>
                        <td className="text-right px-3 py-2 tabular-nums border-r text-red-700 dark:text-red-400">{fmtRate(month.outwardRate)}</td>
                        <td className="text-right px-3 py-2 tabular-nums border-r text-red-700 dark:text-red-400">{fmtVal(month.outwardValue)}</td>
                        <td className="text-right px-3 py-2 tabular-nums font-semibold text-foreground">{fmtQty(month.closingQty)}</td>
                        <td className="text-right px-3 py-2 tabular-nums font-medium">{fmtRate(month.closingRate)}</td>
                        <td className="text-right px-3 py-2 tabular-nums font-medium">{fmtVal(month.closingValue)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                {historyData?.grandTotal && (
                  <tfoot className="sticky bottom-0 z-10">
                    <tr className="bg-muted font-bold border-t-2">
                      <td className="px-3 py-2 border-r">Total</td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-muted-foreground">{historyData.grandTotal.openingQty === 0 ? "—" : historyData.grandTotal.openingQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-muted-foreground">{historyData.grandTotal.openingRate === 0 ? "—" : historyData.grandTotal.openingRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-muted-foreground">{historyData.grandTotal.openingValue === 0 ? "—" : formatAmount(historyData.grandTotal.openingValue)}</td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-green-700 dark:text-green-400">{historyData.grandTotal.inwardQty === 0 ? "—" : historyData.grandTotal.inwardQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-green-700 dark:text-green-400">{historyData.grandTotal.inwardRate === 0 ? "—" : historyData.grandTotal.inwardRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-green-700 dark:text-green-400">{historyData.grandTotal.inwardValue === 0 ? "—" : formatAmount(historyData.grandTotal.inwardValue)}</td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-red-700 dark:text-red-400">{historyData.grandTotal.outwardQty === 0 ? "—" : historyData.grandTotal.outwardQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-red-700 dark:text-red-400">{historyData.grandTotal.outwardRate === 0 ? "—" : historyData.grandTotal.outwardRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-red-700 dark:text-red-400">{historyData.grandTotal.outwardValue === 0 ? "—" : formatAmount(historyData.grandTotal.outwardValue)}</td>
                      <td className="text-right px-3 py-2 tabular-nums text-foreground">{historyData.grandTotal.closingQty === 0 ? "—" : historyData.grandTotal.closingQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="text-right px-3 py-2 tabular-nums">{historyData.grandTotal.closingRate === 0 ? "—" : historyData.grandTotal.closingRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="text-right px-3 py-2 tabular-nums">{historyData.grandTotal.closingValue === 0 ? "—" : formatAmount(historyData.grandTotal.closingValue)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>

          <DialogFooter className="flex-shrink-0 pt-2">
            <Button
              variant="outline"
              onClick={() => setHistoryDialogOpen(false)}
              data-testid="button-history-close"
            >
              Close
            </Button>
            <Button
              variant="default"
              asChild
              data-testid="button-history-open-full"
            >
              <a
                href={`/locations/${historyLocation?.id}/stock-items/${historyItem?.id}/history`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4 mr-1.5" />
                Open full history
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Drill-down: individual transactions for a month ── */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl flex flex-col" style={{ maxHeight: "75vh" }}>
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              {detailDirection === "in" ? (
                <span className="text-green-700 dark:text-green-400">Stock In</span>
              ) : (
                <span className="text-red-700 dark:text-red-400">Stock Out</span>
              )}
              <span className="text-muted-foreground font-normal">—</span>
              <span>{detailMonthName} {detailYear}</span>
            </DialogTitle>
            <DialogDescription>
              {historyItem?.name} · {historyLocation?.name}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-auto min-h-0 border rounded-md">
            {detailLoading ? (
              <div className="space-y-2 p-4">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : (
              (() => {
                const rows = detailDirection === "in"
                  ? (detailData?.inTransactions ?? [])
                  : (detailData?.outTransactions ?? []);

                const typeBadgeClass = (type: string) => {
                  if (type === "Sale") return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
                  if (type.startsWith("Transfer In")) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
                  if (type.startsWith("Transfer Out")) return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
                  if (type.startsWith("Adjustment")) return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
                  if (type === "Credit Note") return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300";
                  return "bg-muted text-muted-foreground";
                };

                if (!rows.length) {
                  return (
                    <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                      No transactions found for this period.
                    </div>
                  );
                }

                const totalQty   = rows.reduce((s: number, r: any) => s + (r.qty   || 0), 0);
                const totalValue = rows.reduce((s: number, r: any) => s + (r.value || 0), 0);
                const avgRate    = totalQty > 0 ? totalValue / totalQty : 0;

                return (
                  <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 z-10 bg-muted border-b">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Type</th>
                        <th className="text-left px-3 py-2 font-medium">Date</th>
                        <th className="text-left px-3 py-2 font-medium">Reference</th>
                        <th className="text-right px-3 py-2 font-medium">Qty</th>
                        <th className="text-right px-3 py-2 font-medium">Rate</th>
                        <th className="text-right px-3 py-2 font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((tx: any, i: number) => (
                        <tr key={i} className="border-b hover:bg-muted/30 transition-colors">
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${typeBadgeClass(tx.type)}`}>
                              {tx.type}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{tx.date}</td>
                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{tx.reference}</td>
                          <td className="text-right px-3 py-2 tabular-nums font-medium">
                            {(tx.qty || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </td>
                          <td className="text-right px-3 py-2 tabular-nums text-muted-foreground">
                            {(tx.rate || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="text-right px-3 py-2 tabular-nums">
                            {formatAmount(tx.value || 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="sticky bottom-0 bg-muted border-t-2 font-semibold">
                      <tr>
                        <td colSpan={3} className="px-3 py-2 text-xs text-muted-foreground">
                          {rows.length} transaction{rows.length !== 1 ? "s" : ""} · Avg rate: {avgRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="text-right px-3 py-2 tabular-nums">
                          {totalQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                        <td />
                        <td className="text-right px-3 py-2 tabular-nums">{formatAmount(totalValue)}</td>
                      </tr>
                    </tfoot>
                  </table>
                );
              })()
            )}
          </div>

          <DialogFooter className="flex-shrink-0 pt-2">
            <Button variant="outline" onClick={() => setDetailOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
