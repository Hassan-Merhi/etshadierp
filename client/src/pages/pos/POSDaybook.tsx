import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { PeriodFilter, PeriodFilterValue, getDefaultPeriodValue } from "@/components/ui/period-filter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar, DollarSign, Package, Eye, EyeOff, Lock, Pencil, Save, X, Plus, Trash2, ArrowRight, Printer } from "lucide-react";
import { useRef } from "react";
import { useReactToPrint } from "react-to-print";
import { format, startOfDay, endOfDay, isValid, parseISO } from "date-fns";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatNumber } from "@/lib/formatNumber";

interface Voucher {
  id: number;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  description: string | null;
  totalAmount: string;
  locationId: number;
  locationName?: string;
  createdAt: string;
}

interface SalesItem {
  id: number;
  stockItemId: number;
  stockItemName?: string;
  quantity: string;
  sellingPrice: string;
  costPrice: string;
  totalSales: string;
  totalCost: string;
  profit: string;
  configuredPrice?: string | null;
}

interface VoucherWithItems extends Voucher {
  salesItems?: SalesItem[];
  exchangeRate?: string | null;
  isCreditSale?: boolean;
  customerName?: string | null;
}

interface InventoryItem {
  stockItemId: number;
  stockItemCode: string;
  stockItemName: string;
  quantity: string;
  averageRate: string;
  lastSellingPrice: string | null;
}

export default function POSDaybook() {
  const { formatDisplayDate } = useDateFormat();
  const { formatCashAmount } = useCurrencyContext();
  const { selectedCompany } = useCompany();
  const isMaliCompany = selectedCompany?.name?.toLowerCase().includes('mali');
  const [selectedVoucher, setSelectedVoucher] = useState<VoucherWithItems | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedItems, setEditedItems] = useState<SalesItem[]>([]);
  const [editedNotes, setEditedNotes] = useState("");
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [selectedDialogRow, setSelectedDialogRow] = useState<number | null>(null);
  const [_location, navigate] = useLocation();
  const { toast } = useToast();
  const reprintRef = useRef<HTMLDivElement>(null);
  const reprintRowRef = useRef<HTMLDivElement>(null);
  const reprintPrintingRef = useRef(false);
  const [reprintRowVoucherId, setReprintRowVoucherId] = useState<number | null>(null);

  // Check for date and voucherId in URL query parameters (from stock item voucher history)
  const urlParams = new URLSearchParams(window.location.search);
  const voucherIdParam = urlParams.get('voucherId');
  const dateParam = urlParams.get('date');

  // Period filter state - initialize based on URL param or default to today
  const getInitialPeriod = (): PeriodFilterValue => {
    if (dateParam) {
      const parsedDate = parseISO(dateParam);
      if (isValid(parsedDate)) {
        const dateStr = format(parsedDate, "yyyy-MM-dd");
        return { fromDate: dateStr, toDate: dateStr, preset: "custom" };
      }
    }
    return getDefaultPeriodValue("today");
  };

  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>(getInitialPeriod);
  const [hiddenRowIds, setHiddenRowIds] = useState<Set<number>>(new Set());
  const [showHidden, setShowHidden] = useState(false);

  // Use periodFilter dates for API queries
  const startDate = periodFilter.fromDate;
  const endDate = periodFilter.toDate;

  // Fetch user permissions
  const { data: currentUser, isLoading: isLoadingUser } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });

  // Only allow editing if explicitly permitted - defaults to false for safety
  // Admin and Owner can always edit regardless of daybookEditDays setting
  const daybookEditDays = currentUser?.daybookEditDays || 0;
  const isAdminOrOwner = currentUser?.role === "Admin" || currentUser?.role === "Owner";
  const canEditDaybook = isAdminOrOwner || daybookEditDays > 0;
  
  // Check if user can see profit/cost (Admin or Owner only)
  const canSeeProfitCost = isAdminOrOwner;

  // Fetch today's sales vouchers (only fetch after user is loaded)
  const { data: vouchers = [], isLoading } = useQuery<Voucher[]>({
    queryKey: ["/api/vouchers", startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const url = `/api/vouchers?${params.toString()}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch vouchers");
      return res.json();
    },
    enabled: !isLoadingUser, // Only fetch vouchers after user data is loaded
  });

  // Filter to show Sales and StockTransfer vouchers from the user's assigned location
  // Exception: When voucherId is provided (from history), bypass location filter for Admin/Owner
  const bypassLocationFilter = voucherIdParam && isAdminOrOwner;
  
  const filteredVouchers = vouchers
    .filter((v) => {
      // Must be a Sales or Stock Transfer voucher
      if (v.voucherType !== "Sales" && v.voucherType !== "Stock Transfer" && v.voucherType !== "StockTransfer") return false;
      
      // Bypass location filter when viewing specific historical voucher
      if (bypassLocationFilter) return true;
      
      // If user has an assigned location (POS users), only show transactions from that location
      if (currentUser?.assignedLocationId !== undefined && currentUser?.assignedLocationId !== null) {
        return v.locationId === currentUser.assignedLocationId;
      }
      
      // Non-POS users see all transactions
      return true;
    })
    // Sort newest first (descending by date, then by voucher number)
    .sort((a, b) => {
      const dateCompare = b.voucherDate.localeCompare(a.voucherDate);
      if (dateCompare !== 0) return dateCompare;
      return b.voucherNumber.localeCompare(a.voucherNumber);
    });
  
  // Backward compatibility alias
  const salesVouchers = filteredVouchers;

  // Visible vouchers: filter out hidden rows unless showHidden is true
  const visibleVouchers = showHidden
    ? salesVouchers
    : salesVouchers.filter((v) => !hiddenRowIds.has(v.id));

  // Fetch voucher details when viewing
  const { data: voucherDetails, isLoading: detailsLoading } = useQuery<VoucherWithItems>({
    queryKey: selectedVoucher ? [`/api/vouchers/${selectedVoucher.id}`] : [],
    enabled: !!selectedVoucher,
  });

  // Fetch inventory for the location when in edit mode
  const { data: inventory = [] } = useQuery<InventoryItem[]>({
    queryKey: selectedVoucher?.locationId ? [`/api/locations/${selectedVoucher.locationId}/inventory`] : [],
    enabled: !!selectedVoucher?.locationId && isEditMode,
  });

  // Populate editedItems when voucher details load (deep clone to avoid mutating cached data)
  useEffect(() => {
    if (voucherDetails?.salesItems && isEditMode) {
      setEditedItems(JSON.parse(JSON.stringify(voucherDetails.salesItems)));
      setEditedNotes(voucherDetails.description || "");
    }
  }, [voucherDetails, isEditMode]);

  // Auto-select voucher from URL parameter
  useEffect(() => {
    if (voucherIdParam && vouchers.length > 0 && !selectedVoucher) {
      const voucherId = parseInt(voucherIdParam);
      const voucherToSelect = vouchers.find(v => v.id === voucherId);
      
      // Clear the voucherId parameter from URL
      const newParams = new URLSearchParams(window.location.search);
      newParams.delete('voucherId');
      const newSearch = newParams.toString();
      const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '');
      window.history.replaceState({}, '', newUrl);

      if (voucherToSelect) {
        setSelectedVoucher(voucherToSelect);
      } else {
        // Voucher not found - show feedback
        toast({
          variant: "destructive",
          title: "Voucher not found",
          description: "The requested sales transaction could not be found for this date.",
        });
      }
    }
  }, [voucherIdParam, vouchers, selectedVoucher, toast]);

  // Reset selected row when dialog opens/closes or mode changes
  useEffect(() => {
    setSelectedDialogRow(null);
  }, [selectedVoucher, isEditMode]);

  // Scroll highlighted row into view when using arrow keys
  useEffect(() => {
    if (selectedDialogRow === null) return;
    const row = document.querySelector(`[data-dialog-row="${selectedDialogRow}"]`);
    if (row) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedDialogRow]);

  // Keyboard navigation for dialog item rows
  const getDialogItems = useCallback((): Array<{ stockItemId?: number; stockItemName?: string }> => {
    if (!selectedVoucher) return [];
    if (isEditMode) return editedItems;
    return (voucherDetails as any)?.salesItems || [];
  }, [selectedVoucher, isEditMode, editedItems, voucherDetails]);

  useEffect(() => {
    if (!selectedVoucher) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isTyping = tag === "input" || tag === "textarea" || (e.target as HTMLElement)?.isContentEditable;

      const items = getDialogItems();

      if (e.key === "ArrowDown" && !isTyping) {
        e.preventDefault();
        setSelectedDialogRow(prev => {
          if (prev === null) return 0;
          return Math.min(prev + 1, items.length - 1);
        });
        return;
      }

      if (e.key === "ArrowUp" && !isTyping) {
        e.preventDefault();
        setSelectedDialogRow(prev => {
          if (prev === null) return items.length - 1;
          return Math.max(prev - 1, 0);
        });
        return;
      }

      // Alt+S → open Stock Item detail directly for selected item
      if (e.altKey && (e.key === "s" || e.key === "S" || e.key === "ß")) {
        e.preventDefault();
        if (selectedDialogRow !== null && items[selectedDialogRow]) {
          const itemId = items[selectedDialogRow].stockItemId;
          if (itemId) {
            navigate(`/stock-query/${itemId}?from=pos-daybook`);
            setSelectedVoucher(null);
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [selectedVoucher, getDialogItems, navigate, selectedDialogRow]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedVoucher) throw new Error("No voucher selected");

      const items = editedItems.map(item => {
        const payload: any = {
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          sellingPrice: item.sellingPrice,
        };
        
        // Only include ID for existing items (positive IDs), not new items (negative IDs)
        if (item.id > 0) {
          payload.id = item.id;
        }
        
        return payload;
      });

      return await apiRequest("PUT", `/api/vouchers/${selectedVoucher.id}/sales`, {
        description: editedNotes,
        items,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Transaction updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/vouchers/${selectedVoucher?.id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      if (selectedVoucher?.locationId) {
        queryClient.invalidateQueries({ queryKey: [`/api/locations/${selectedVoucher.locationId}/inventory`] });
      }
      setIsEditMode(false);
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleEdit = () => {
    if (selectedVoucher) {
      navigate(`/pos/edit/${selectedVoucher.id}`);
    }
  };

  const fmtPrint = (n: number, prefix = "") => {
    const parts = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",").split(".");
    const num = parts[1] === "00" ? parts[0] : parts.join(".");
    return prefix ? prefix + "\u00A0" + num : num;
  };

  const handleReprint = useReactToPrint({
    contentRef: reprintRef,
  });

  const handleReprintRow = useReactToPrint({
    contentRef: reprintRowRef,
    onAfterPrint: () => {
      reprintPrintingRef.current = false;
      setReprintRowVoucherId(null);
    },
  });

  // Fetch voucher details for row-level reprint
  const { data: reprintRowDetails, isLoading: reprintRowLoading } = useQuery<VoucherWithItems>({
    queryKey: reprintRowVoucherId ? [`/api/vouchers/${reprintRowVoucherId}`] : [],
    enabled: !!reprintRowVoucherId,
    retry: false,
  });

  // Auto-trigger print once details load — guard prevents double-trigger
  useEffect(() => {
    if (reprintRowDetails && reprintRowVoucherId && !reprintRowLoading && !reprintPrintingRef.current) {
      reprintPrintingRef.current = true;
      setTimeout(() => handleReprintRow(), 100);
    }
  }, [reprintRowDetails, reprintRowVoucherId, reprintRowLoading]);

  const handleCancelEdit = () => {
    setIsEditMode(false);
    setEditedItems([]);
    setEditedNotes("");
  };

  const handleSave = () => {
    saveMutation.mutate();
  };

  const handleItemChange = (index: number, field: keyof SalesItem, value: string) => {
    const newItems = [...editedItems];
    newItems[index] = { ...newItems[index], [field]: value };
    
    // Recalculate totals
    const qty = parseFloat(newItems[index].quantity) || 0;
    const price = parseFloat(newItems[index].sellingPrice) || 0;
    const cost = parseFloat(newItems[index].costPrice) || 0;
    
    newItems[index].totalSales = formatNumber(qty * price);
    newItems[index].totalCost = formatNumber(qty * cost);
    newItems[index].profit = formatNumber(qty * (price - cost));
    
    setEditedItems(newItems);
  };

  const handleAddItem = (item: InventoryItem) => {
    // Create new sales item with current inventory cost and default price
    const newItem: SalesItem = {
      id: -Date.now(), // Temporary negative ID for new items
      stockItemId: item.stockItemId,
      stockItemName: item.stockItemName,
      quantity: "1",
      sellingPrice: item.lastSellingPrice || item.averageRate,
      costPrice: item.averageRate, // Use current cost for new items
      totalSales: item.lastSellingPrice || item.averageRate,
      totalCost: item.averageRate,
      profit: formatNumber((parseFloat(item.lastSellingPrice || item.averageRate) - parseFloat(item.averageRate)) * 1),
    };
    
    setEditedItems([...editedItems, newItem]);
    setAddItemOpen(false);
    setItemSearch("");
  };

  const handleRemoveItem = (index: number) => {
    if (editedItems.length <= 1) {
      toast({ title: "Cannot remove", description: "A sale must have at least one item.", variant: "destructive" });
      return;
    }
    const newItems = editedItems.filter((_, i) => i !== index);
    setEditedItems(newItems);
  };

  // Separate sales from transfers for accurate metrics
  const salesOnlyVouchers = salesVouchers.filter(v => v.voucherType === "Sales");
  const transferVouchers = salesVouchers.filter(v => v.voucherType !== "Sales");
  
  const totalSales = salesOnlyVouchers.reduce((sum, v) => sum + parseFloat(v.totalAmount), 0);
  const salesTransactionCount = salesOnlyVouchers.length;
  const transferCount = transferVouchers.length;

  // Generate subtitle based on period filter
  const getSubtitle = () => {
    const fromDate = new Date(periodFilter.fromDate);
    const toDate = new Date(periodFilter.toDate);
    if (periodFilter.fromDate === periodFilter.toDate) {
      return `Sales transactions - ${formatDisplayDate(fromDate)}`;
    }
    return `Sales transactions - ${formatDisplayDate(fromDate)} to ${formatDisplayDate(toDate)}`;
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <PageHeader 
          title="POS Daybook" 
          subtitle={getSubtitle()}
        />
        <PeriodFilter
          value={periodFilter}
          onChange={setPeriodFilter}
          data-testid="pos-daybook-period-filter"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 md:gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 p-3 pb-1 md:p-6 md:pb-2">
            <CardTitle className="text-xs md:text-sm font-medium">
              Sales
            </CardTitle>
            <Package className="h-3 w-3 md:h-4 md:w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
            {isLoading ? (
              <Skeleton className="h-6 w-16" />
            ) : (
              <div className="text-xl md:text-2xl font-semibold" data-testid="text-transaction-count">
                {salesTransactionCount}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 p-3 pb-1 md:p-6 md:pb-2">
            <CardTitle className="text-xs md:text-sm font-medium">
              Total
            </CardTitle>
            <DollarSign className="h-3 w-3 md:h-4 md:w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
            {isLoading ? (
              <Skeleton className="h-6 w-20" />
            ) : (
              <div className="text-lg md:text-2xl font-semibold" data-testid="text-total-sales">
                {formatCashAmount(totalSales)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 p-3 pb-1 md:p-6 md:pb-2">
            <CardTitle className="text-xs md:text-sm font-medium">
              Average
            </CardTitle>
            <Calendar className="h-3 w-3 md:h-4 md:w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
            {isLoading ? (
              <Skeleton className="h-6 w-20" />
            ) : (
              <div className="text-lg md:text-2xl font-semibold" data-testid="text-avg-transaction">
                {formatCashAmount(salesTransactionCount > 0 ? totalSales / salesTransactionCount : 0)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 p-3 pb-1 md:p-6 md:pb-2">
            <CardTitle className="text-xs md:text-sm font-medium">
              Transfers
            </CardTitle>
            <ArrowRight className="h-3 w-3 md:h-4 md:w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
            {isLoading ? (
              <Skeleton className="h-6 w-16" />
            ) : (
              <div className="text-xl md:text-2xl font-semibold" data-testid="text-transfer-count">
                {transferCount}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">
            Transactions
            {hiddenRowIds.size > 0 && !showHidden && (
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({visibleVouchers.length} of {salesVouchers.length})
              </span>
            )}
          </CardTitle>
          {hiddenRowIds.size > 0 && (
            <div className="flex items-center gap-2">
              <Button
                variant={showHidden ? "secondary" : "outline"}
                size="sm"
                onClick={() => setShowHidden((prev) => !prev)}
                data-testid="button-toggle-show-hidden"
                className="gap-1"
              >
                <EyeOff className="w-4 h-4" />
                {showHidden ? "Hide hidden rows" : "Show hidden"}
                <Badge className="ml-1">{hiddenRowIds.size}</Badge>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setHiddenRowIds(new Set()); setShowHidden(false); }}
                className="gap-1 text-muted-foreground"
                data-testid="button-clear-hidden-rows"
                title="Clear all hidden rows"
              >
                <X className="w-4 h-4" />
                Clear
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoadingUser || isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : salesVouchers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">No transactions found</p>
              <p className="text-sm mt-1">Sales and transfers will appear here for the selected period</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Time</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs hidden sm:table-cell">Location</TableHead>
                    <TableHead className="text-xs text-right">Amount</TableHead>
                    <TableHead className="text-xs hidden md:table-cell">Notes</TableHead>
                    <TableHead className="text-xs text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleVouchers.map((voucher) => {
                    const isHidden = hiddenRowIds.has(voucher.id);
                    return (
                      <TableRow
                        key={voucher.id}
                        data-testid={`row-voucher-${voucher.id}`}
                        className={isHidden && showHidden ? "opacity-50" : ""}
                      >
                        <TableCell className="font-mono text-xs">
                          {format(new Date(voucher.createdAt), "MMM dd, hh:mm a")}
                        </TableCell>
                        <TableCell>
                          <Badge variant={voucher.voucherType === "Sales" ? "default" : "outline"} className="text-xs">
                            {voucher.voucherType === "Sales" ? "Sale" : "Transfer"}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <Badge variant="secondary" className="text-xs">
                            {voucher.locationName || `Location ${voucher.locationId}`}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-semibold">
                          {formatCashAmount(voucher.totalAmount)}
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-xs hidden md:table-cell">
                          {voucher.description || "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {voucher.voucherType === "Sales" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setReprintRowVoucherId(voucher.id)}
                                disabled={reprintRowVoucherId === voucher.id}
                                data-testid={`button-reprint-row-${voucher.id}`}
                                title="Reprint invoice"
                              >
                                <Printer className={`h-4 w-4 ${reprintRowVoucherId === voucher.id ? "animate-pulse" : ""}`} />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setSelectedVoucher(voucher as VoucherWithItems)}
                              data-testid={`button-view-${voucher.id}`}
                              title="View details"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title={isHidden ? "Unhide row" : "Hide row"}
                              onClick={() => {
                                if (isHidden) {
                                  setHiddenRowIds((prev) => { const next = new Set(prev); next.delete(voucher.id); return next; });
                                } else {
                                  setHiddenRowIds((prev) => { const next = new Set(prev); next.add(voucher.id); return next; });
                                }
                              }}
                              data-testid={isHidden ? `button-unhide-${voucher.id}` : `button-hide-${voucher.id}`}
                            >
                              {isHidden ? <Eye className="h-4 w-4 text-muted-foreground" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Hidden row-level reprint template (outside dialog, always in DOM) */}
      <div className="hidden">
        <div ref={reprintRowRef} style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '11pt', padding: '12px', backgroundColor: 'white', color: 'black', width: '100%', fontWeight: 'normal', fontVariantNumeric: 'tabular-nums' }}>
          <style dangerouslySetInnerHTML={{ __html: `@media print { body { font-family: Arial, Helvetica, sans-serif !important; } * { font-family: Arial, Helvetica, sans-serif !important; font-variant-numeric: tabular-nums !important; } }` }} />
          <div style={{ textAlign: 'center', fontWeight: '900', fontSize: '18pt', letterSpacing: '2px', marginBottom: '6px' }}>POS INVOICE</div>
          <div style={{ fontSize: '11pt', fontWeight: '700', display: 'flex', justifyContent: 'space-between', borderTop: '2px solid black', borderBottom: '2px solid black', padding: '5px 0', marginBottom: '6px' }}>
            <span>Date: {reprintRowDetails?.voucherDate}</span>
            <span>User: {currentUser?.fullName || currentUser?.name || currentUser?.username || currentUser?.email}</span>
          </div>
          {isMaliCompany && reprintRowDetails?.exchangeRate && (
            <div style={{ fontSize: '11pt', fontWeight: '700', marginBottom: '6px', padding: '4px', border: '2px solid black', textAlign: 'center' }}>
              <span style={{ fontWeight: '900' }}>Daily Rate:</span> $1 = {formatNumber(parseFloat(String(reprintRowDetails.exchangeRate)))} CFA
            </div>
          )}
          {reprintRowDetails?.isCreditSale && (
            <div style={{ fontSize: '10pt', fontWeight: '700', marginBottom: '6px', padding: '4px', border: '2px solid black' }}>
              <div style={{ fontWeight: '900' }}>CREDIT SALE</div>
              {reprintRowDetails.customerName && <div>Customer: {reprintRowDetails.customerName}</div>}
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11pt', marginBottom: '0', fontVariantNumeric: 'tabular-nums', border: '1px solid #999' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '4px 7px', width: '30%', fontWeight: '900', fontSize: '9pt', border: '1px solid #999', backgroundColor: '#eeeeee' }}>Description</th>
                <th style={{ textAlign: 'center', padding: '4px 7px', width: '6%', fontWeight: '900', fontSize: '9pt', border: '1px solid #999', backgroundColor: '#eeeeee' }}>Qty</th>
                <th style={{ textAlign: 'center', padding: '4px 7px', width: '9%', fontWeight: '900', fontSize: '9pt', border: '1px solid #999', backgroundColor: '#eeeeee' }}>Rate</th>
                <th style={{ textAlign: 'center', padding: '4px 7px', width: '10%', fontWeight: '900', fontSize: '9pt', border: '1px solid #999', backgroundColor: '#eeeeee' }}>Amt</th>
                <th style={{ textAlign: 'center', padding: '4px 7px', width: '10%', fontWeight: '900', fontSize: '9pt', border: '1px solid #999', backgroundColor: '#eeeeee' }}>Config</th>
                <th style={{ textAlign: 'center', padding: '4px 7px', width: '12%', fontWeight: '900', fontSize: '9pt', border: '1px solid #999', backgroundColor: '#eeeeee' }}>P/L Bale</th>
                <th style={{ textAlign: 'center', padding: '4px 7px', width: '13%', fontWeight: '900', fontSize: '9pt', border: '1px solid #999', backgroundColor: '#eeeeee' }}>Total P/L</th>
              </tr>
            </thead>
            <tbody>
              {(reprintRowDetails?.salesItems ?? []).map((item: any, idx: number) => {
                const rate = parseFloat(item.sellingPrice || "0");
                const qty = parseFloat(item.quantity || "0");
                const configPrice = parseFloat(item.configuredPrice || "0");
                const plPerBale = rate - configPrice;
                const totalPL = plPerBale * qty;
                const rowBg = idx % 2 === 0 ? '#ffffff' : '#f5f5f5';
                return (
                  <tr key={idx} style={{ backgroundColor: rowBg }}>
                    <td style={{ padding: '4px 7px', verticalAlign: 'top', wordBreak: 'break-word', fontWeight: '600', lineHeight: '1.3', fontSize: '9pt', border: '1px solid #c8c8c8' }}>{item.stockItemName}</td>
                    <td style={{ textAlign: 'center', padding: '4px 7px', verticalAlign: 'top', fontWeight: '600', fontSize: '9pt', border: '1px solid #c8c8c8' }}>{fmtPrint(qty)}</td>
                    <td style={{ textAlign: 'center', padding: '4px 7px', verticalAlign: 'top', fontWeight: '600', fontSize: '9pt', border: '1px solid #c8c8c8' }}>{fmtPrint(rate, "$")}</td>
                    <td style={{ textAlign: 'center', padding: '4px 7px', verticalAlign: 'top', fontWeight: '600', fontSize: '9pt', border: '1px solid #c8c8c8' }}>{fmtPrint(qty * rate, "$")}</td>
                    <td style={{ textAlign: 'center', padding: '4px 7px', verticalAlign: 'top', fontWeight: '600', fontSize: '9pt', border: '1px solid #c8c8c8' }}>{fmtPrint(configPrice, "$")}</td>
                    <td style={{ textAlign: 'center', padding: '4px 7px', verticalAlign: 'top', fontWeight: '600', fontSize: '9pt', border: '1px solid #c8c8c8', color: plPerBale > 0 ? '#0a7e1f' : plPerBale < 0 ? '#c2272d' : undefined }}>{fmtPrint(plPerBale, "$")}</td>
                    <td style={{ textAlign: 'center', padding: '4px 7px', verticalAlign: 'top', fontWeight: '600', fontSize: '9pt', border: '1px solid #c8c8c8', color: totalPL > 0 ? '#0a7e1f' : totalPL < 0 ? '#c2272d' : undefined }}>{fmtPrint(totalPL, "$")}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ padding: '4px 7px', fontWeight: '900', fontSize: '9pt', border: '1px solid #999', backgroundColor: '#eeeeee' }}>TOTAL</td>
                <td style={{ textAlign: 'center', padding: '4px 7px', fontWeight: '900', fontSize: '9pt', border: '1px solid #999', backgroundColor: '#eeeeee' }}>{fmtPrint((reprintRowDetails?.salesItems ?? []).reduce((s, i) => s + parseFloat(i.quantity || "0"), 0))}</td>
                <td style={{ padding: '4px 7px', border: '1px solid #999', backgroundColor: '#eeeeee' }}></td>
                <td style={{ textAlign: 'center', padding: '4px 7px', fontWeight: '900', fontSize: '9pt', border: '1px solid #999', backgroundColor: '#eeeeee' }}>{fmtPrint((reprintRowDetails?.salesItems ?? []).reduce((s, i) => s + parseFloat(i.quantity || "0") * parseFloat(i.sellingPrice || "0"), 0), "$")}</td>
                <td style={{ padding: '4px 7px', border: '1px solid #999', backgroundColor: '#eeeeee' }}></td>
                <td style={{ padding: '4px 7px', border: '1px solid #999', backgroundColor: '#eeeeee' }}></td>
                <td style={{ textAlign: 'center', padding: '4px 7px', fontWeight: '900', fontSize: '9pt', border: '1px solid #999', backgroundColor: '#eeeeee', color: (() => { const t = (reprintRowDetails?.salesItems ?? []).reduce((s, i) => s + (parseFloat(i.sellingPrice || "0") - parseFloat(i.configuredPrice || "0")) * parseFloat(i.quantity || "0"), 0); return t > 0 ? '#0a7e1f' : t < 0 ? '#c2272d' : undefined; })() }}>
                  {(() => {
                    const t = (reprintRowDetails?.salesItems ?? []).reduce((s, i) => s + (parseFloat(i.sellingPrice || "0") - parseFloat(i.configuredPrice || "0")) * parseFloat(i.quantity || "0"), 0);
                    return fmtPrint(t, "$");
                  })()}
                </td>
              </tr>
            </tfoot>
          </table>
          <div style={{ fontSize: '14pt', fontWeight: '900', marginTop: '8px', paddingTop: '8px', borderTop: '1.5px solid #333', display: 'flex', justifyContent: 'space-between' }}>
            <span>TOTAL PAID:</span>
            <span>{fmtPrint((reprintRowDetails?.salesItems ?? []).reduce((s, i) => s + parseFloat(i.quantity || "0") * parseFloat(i.sellingPrice || "0"), 0), "$")}</span>
          </div>
          {reprintRowDetails?.description && (
            <div style={{ fontSize: '9pt', fontWeight: '600', marginTop: '8px', padding: '4px', border: '2px solid black' }}>
              <span style={{ fontWeight: '900' }}>Note:</span> {reprintRowDetails.description}
            </div>
          )}
          <div style={{ textAlign: 'center', fontSize: '9pt', fontWeight: '700', marginTop: '10px', paddingTop: '5px', borderTop: '2px solid black' }}>
            <div>Thank you for your business!</div>
          </div>
        </div>
      </div>

      {/* Transaction Details Dialog */}
      <Dialog open={!!selectedVoucher} onOpenChange={() => setSelectedVoucher(null)}>
        <DialogContent className="w-[95vw] max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">
              Transaction Details - {selectedVoucher?.voucherNumber}
            </DialogTitle>
            <div className="flex flex-wrap items-center gap-2 sm:gap-4 pt-2 text-sm text-muted-foreground">
              <span>{selectedVoucher && `${formatDisplayDate(new Date(selectedVoucher.createdAt))} at ${format(new Date(selectedVoucher.createdAt), "hh:mm a")}`}</span>
              <span>•</span>
              <span>{selectedVoucher?.locationName || `Location ${selectedVoucher?.locationId}`}</span>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            {detailsLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : isEditMode ? (
              <div className="space-y-4">
                <div className="border-b pb-4">
                  <p className="text-sm font-medium text-muted-foreground mb-2">Notes</p>
                  <Textarea
                    value={editedNotes}
                    onChange={(e) => setEditedNotes(e.target.value)}
                    placeholder="Add notes..."
                    className="min-h-[60px]"
                    data-testid="input-notes"
                  />
                </div>

                <div>
                  <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                    <p className="text-sm font-medium text-muted-foreground">Items Sold</p>
                    <Popover open={addItemOpen} onOpenChange={setAddItemOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid="button-add-item"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Add Item
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 p-0" align="end">
                        <Command>
                          <CommandInput
                            placeholder="Search items..."
                            value={itemSearch}
                            onValueChange={setItemSearch}
                            data-testid="input-item-search"
                          />
                          <CommandList>
                            <CommandEmpty>No items found.</CommandEmpty>
                            <CommandGroup>
                              {inventory
                                .filter(item => 
                                  (item.stockItemName || "").toLowerCase().includes(itemSearch.toLowerCase()) ||
                                  (item.stockItemCode || "").toLowerCase().includes(itemSearch.toLowerCase())
                                )
                                .map((item) => (
                                  <CommandItem
                                    key={item.stockItemId}
                                    value={item.stockItemName || ""}
                                    onSelect={() => handleAddItem(item)}
                                    data-testid={`item-${item.stockItemId}`}
                                  >
                                    <div className="flex justify-between w-full">
                                      <div>
                                        <div className="font-medium">{item.stockItemName || "Unknown Item"}</div>
                                        <div className="text-xs text-muted-foreground">{item.stockItemCode || ""}</div>
                                      </div>
                                      <div className="text-sm font-mono">
                                        {formatCashAmount(parseFloat(item.lastSellingPrice || item.averageRate))}
                                      </div>
                                    </div>
                                  </CommandItem>
                                ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">Hover or use ↑↓ to select · Alt+S to view item</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        {canSeeProfitCost && <TableHead className="text-right">Cost</TableHead>}
                        <TableHead className="text-right">Total</TableHead>
                        {canSeeProfitCost && <TableHead className="text-right">Profit</TableHead>}
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {editedItems.map((item, idx) => {
                        const profit = parseFloat(item.profit || "0");
                        const isPositiveProfit = profit >= 0;
                        
                        return (
                          <TableRow
                            key={item.id || idx}
                            data-dialog-row={idx}
                            className={selectedDialogRow === idx ? "bg-accent" : ""}
                            onMouseEnter={() => setSelectedDialogRow(idx)}
                          >
                            <TableCell className="font-medium">
                              {item.stockItemName || `Item ${item.stockItemId}`}
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                step="0.01"
                                min="0.01"
                                value={item.quantity}
                                onChange={(e) => handleItemChange(idx, "quantity", e.target.value)}
                                className="text-right font-mono w-24"
                                data-testid={`input-quantity-${idx}`}
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                step="0.01"
                                min="0.01"
                                value={item.sellingPrice}
                                onChange={(e) => handleItemChange(idx, "sellingPrice", e.target.value)}
                                className="text-right font-mono w-24"
                                data-testid={`input-price-${idx}`}
                              />
                            </TableCell>
                            {canSeeProfitCost && (
                              <TableCell className="text-right font-mono text-muted-foreground">
                                {formatCashAmount(parseFloat(item.costPrice || "0"))}
                              </TableCell>
                            )}
                            <TableCell className="text-right font-mono font-semibold">
                              {formatCashAmount(parseFloat(item.totalSales))}
                            </TableCell>
                            {canSeeProfitCost && (
                              <TableCell className={`text-right font-mono font-semibold ${isPositiveProfit ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                {formatCashAmount(profit)}
                              </TableCell>
                            )}
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemoveItem(idx)}
                                data-testid={`button-remove-${idx}`}
                                className="h-8 w-8"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="border-t pt-4 flex justify-between">
                  {canSeeProfitCost && (
                    <div className="space-y-1">
                      <div className="text-sm">
                        <span className="text-muted-foreground">Total Cost: </span>
                        <span className="font-mono font-semibold">
                          {formatCashAmount(editedItems.reduce((sum, item) => sum + parseFloat(item.totalCost || "0"), 0))}
                        </span>
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">Total Profit: </span>
                        <span className="font-mono font-semibold text-green-600 dark:text-green-400">
                          {formatCashAmount(editedItems.reduce((sum, item) => sum + parseFloat(item.profit || "0"), 0))}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="text-sm">
                    <span className="text-muted-foreground">Total Sales: </span>
                    <span className="font-mono font-semibold">
                      {formatCashAmount(editedItems.reduce((sum, item) => sum + parseFloat(item.totalSales), 0))}
                    </span>
                  </div>
                </div>
              </div>
            ) : voucherDetails?.salesItems && voucherDetails.salesItems.length > 0 ? (
              <div className="space-y-4">
                {voucherDetails?.description && (
                  <div className="border-b pb-4">
                    <p className="text-sm font-medium text-muted-foreground">Notes</p>
                    <p className="text-sm mt-1">{voucherDetails.description}</p>
                  </div>
                )}

                <div className="overflow-x-auto">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-muted-foreground">Items Sold</p>
                    <p className="text-xs text-muted-foreground">Hover or use ↑↓ to select · Alt+S to view item</p>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        {canSeeProfitCost && <TableHead className="text-right">Cost</TableHead>}
                        <TableHead className="text-right">Total</TableHead>
                        {canSeeProfitCost && <TableHead className="text-right">Profit</TableHead>}
                        {canSeeProfitCost && <TableHead className="text-right">Hassan's Price</TableHead>}
                        {canSeeProfitCost && <TableHead className="text-right">Hassan's Profit</TableHead>}
                        {canSeeProfitCost && <TableHead className="text-right">Hassan's %</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {voucherDetails.salesItems.map((item: any, idx: number) => {
                        const profit = parseFloat(item.profit || "0");
                        const isPositiveProfit = profit >= 0;
                        const hassansProfit = parseFloat(item.hassansProfit || "0");
                        const isHassansProfitPositive = hassansProfit >= 0;
                        
                        return (
                          <TableRow
                            key={item.id || idx}
                            data-dialog-row={idx}
                            className={`cursor-pointer ${selectedDialogRow === idx ? "bg-accent" : ""}`}
                            onMouseEnter={() => setSelectedDialogRow(idx)}
                          >
                            <TableCell className="font-medium">
                              {item.stockItemName || `Item ${item.stockItemId}`}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatNumber(parseFloat(item.quantity), 0)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCashAmount(parseFloat(item.sellingPrice))}
                            </TableCell>
                            {canSeeProfitCost && (
                              <TableCell className="text-right font-mono text-muted-foreground">
                                {formatCashAmount(parseFloat(item.costPrice || "0"))}
                              </TableCell>
                            )}
                            <TableCell className="text-right font-mono font-semibold">
                              {formatCashAmount(parseFloat(item.totalSales))}
                            </TableCell>
                            {canSeeProfitCost && (
                              <TableCell className={`text-right font-mono font-semibold ${isPositiveProfit ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                {formatCashAmount(profit)}
                              </TableCell>
                            )}
                            {canSeeProfitCost && (
                              <TableCell className="text-right font-mono text-muted-foreground">
                                {formatCashAmount(parseFloat(item.configuredPrice || "0"))}
                              </TableCell>
                            )}
                            {canSeeProfitCost && (
                              <TableCell className={`text-right font-mono font-semibold ${isHassansProfitPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                {formatCashAmount(hassansProfit)}
                              </TableCell>
                            )}
                            {canSeeProfitCost && (
                              <TableCell className={`text-right font-mono ${isHassansProfitPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                {item.hassansPercentage || "0"}%
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="border-t pt-4 flex flex-wrap gap-4 justify-between">
                  <div className="text-sm">
                    <span className="text-muted-foreground">Total Sales: </span>
                    <span className="font-mono font-semibold">
                      {formatCashAmount(voucherDetails.salesItems.reduce((sum: number, item: any) => sum + parseFloat(item.totalSales), 0))}
                    </span>
                  </div>
                  {canSeeProfitCost && (
                    <>
                      <div className="text-sm">
                        <span className="text-muted-foreground">Total Cost: </span>
                        <span className="font-mono font-semibold">
                          {formatCashAmount(voucherDetails.salesItems.reduce((sum: number, item: any) => sum + parseFloat(item.totalCost || "0"), 0))}
                        </span>
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">Total Profit: </span>
                        <span className="font-mono font-semibold text-green-600 dark:text-green-400">
                          {formatCashAmount(voucherDetails.salesItems.reduce((sum: number, item: any) => sum + parseFloat(item.profit || "0"), 0))}
                        </span>
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">Hassan's Total: </span>
                        <span className="font-mono font-semibold">
                          {formatCashAmount(voucherDetails.salesItems.reduce((sum: number, item: any) => sum + parseFloat(item.hassansTotal || "0"), 0))}
                        </span>
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">Hassan's Profit: </span>
                        <span className={`font-mono font-semibold ${voucherDetails.salesItems.reduce((sum: number, item: any) => sum + parseFloat(item.hassansProfit || "0"), 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          {formatCashAmount(voucherDetails.salesItems.reduce((sum: number, item: any) => sum + parseFloat(item.hassansProfit || "0"), 0))}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No items found for this transaction
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            {isEditMode ? (
              <>
                <Button 
                  variant="outline" 
                  onClick={handleCancelEdit}
                  disabled={saveMutation.isPending}
                  data-testid="button-cancel-edit"
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button 
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  data-testid="button-save"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {saveMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </>
            ) : (
              <>
                {/* Hidden print template for reprint — matches POS invoice exactly */}
                <div className="hidden">
                  <div ref={reprintRef} style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '11pt', padding: '12px', backgroundColor: 'white', color: 'black', width: '100%', fontWeight: 'normal', fontVariantNumeric: 'tabular-nums' }}>
                    <style dangerouslySetInnerHTML={{ __html: `@media print { body { font-family: Arial, Helvetica, sans-serif !important; } * { font-family: Arial, Helvetica, sans-serif !important; font-variant-numeric: tabular-nums !important; } }` }} />
                    {/* Title */}
                    <div style={{ textAlign: 'center', fontWeight: '900', fontSize: '18pt', letterSpacing: '2px', marginBottom: '6px' }}>POS INVOICE</div>
                    {/* Date + User row */}
                    <div style={{ fontSize: '11pt', fontWeight: '700', display: 'flex', justifyContent: 'space-between', borderTop: '2px solid black', borderBottom: '2px solid black', padding: '5px 0', marginBottom: '6px' }}>
                      <span>Date: {voucherDetails?.voucherDate}</span>
                      <span>User: {currentUser?.fullName || currentUser?.name || currentUser?.username || currentUser?.email}</span>
                    </div>
                    {/* Daily Rate — Mali company only */}
                    {isMaliCompany && voucherDetails?.exchangeRate && (
                      <div style={{ fontSize: '11pt', fontWeight: '700', marginBottom: '6px', padding: '4px', border: '2px solid black', textAlign: 'center' }}>
                        <span style={{ fontWeight: '900' }}>Daily Rate:</span> $1 = {formatNumber(parseFloat(String(voucherDetails.exchangeRate)))} CFA
                      </div>
                    )}
                    {/* Credit Sale */}
                    {voucherDetails?.isCreditSale && (
                      <div style={{ fontSize: '10pt', fontWeight: '700', marginBottom: '6px', padding: '4px', border: '2px solid black' }}>
                        <div style={{ fontWeight: '900' }}>CREDIT SALE</div>
                        {voucherDetails.customerName && (
                          <div>Customer: {voucherDetails.customerName}</div>
                        )}
                      </div>
                    )}
                    {/* Items table */}
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11pt', marginBottom: '0', fontVariantNumeric: 'tabular-nums', border: '1px solid #999' }}>
                      <thead className="sticky top-0 z-10 bg-muted/50">
                        <tr>
                          <th style={{ textAlign: 'left', padding: '4px 7px', width: '30%', fontWeight: '900', fontSize: '9pt', border: '1px solid #999', backgroundColor: '#eeeeee' }}>Description</th>
                          <th style={{ textAlign: 'center', padding: '4px 7px', width: '6%', fontWeight: '900', fontSize: '9pt', border: '1px solid #999', backgroundColor: '#eeeeee' }}>Qty</th>
                          <th style={{ textAlign: 'center', padding: '4px 7px', width: '9%', fontWeight: '900', fontSize: '9pt', border: '1px solid #999', backgroundColor: '#eeeeee' }}>Rate</th>
                          <th style={{ textAlign: 'center', padding: '4px 7px', width: '10%', fontWeight: '900', fontSize: '9pt', border: '1px solid #999', backgroundColor: '#eeeeee' }}>Amt</th>
                          <th style={{ textAlign: 'center', padding: '4px 7px', width: '10%', fontWeight: '900', fontSize: '9pt', border: '1px solid #999', backgroundColor: '#eeeeee' }}>Config</th>
                          <th style={{ textAlign: 'center', padding: '4px 7px', width: '12%', fontWeight: '900', fontSize: '9pt', border: '1px solid #999', backgroundColor: '#eeeeee' }}>P/L Bale</th>
                          <th style={{ textAlign: 'center', padding: '4px 7px', width: '13%', fontWeight: '900', fontSize: '9pt', border: '1px solid #999', backgroundColor: '#eeeeee' }}>Total P/L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(voucherDetails?.salesItems ?? []).map((item: any, idx) => {
                          const rate = parseFloat(item.sellingPrice || "0");
                          const qty = parseFloat(item.quantity || "0");
                          const configPrice = parseFloat(item.configuredPrice || "0");
                          const plPerBale = rate - configPrice;
                          const totalPL = plPerBale * qty;
                          const plBaleColor = plPerBale > 0 ? '#0a7e1f' : plPerBale < 0 ? '#c2272d' : undefined;
                          const totalPLColor = totalPL > 0 ? '#0a7e1f' : totalPL < 0 ? '#c2272d' : undefined;
                          const rowBg = idx % 2 === 0 ? '#ffffff' : '#f5f5f5';
                          return (
                            <tr key={idx} style={{ backgroundColor: rowBg }}>
                              <td style={{ padding: '4px 7px', verticalAlign: 'top', wordBreak: 'break-word', fontWeight: '600', lineHeight: '1.3', fontSize: '9pt', border: '1px solid #c8c8c8' }}>{item.stockItemName}</td>
                              <td style={{ textAlign: 'center', padding: '4px 7px', verticalAlign: 'top', fontWeight: '600', fontSize: '9pt', border: '1px solid #c8c8c8' }}>{fmtPrint(qty)}</td>
                              <td style={{ textAlign: 'center', padding: '4px 7px', verticalAlign: 'top', fontWeight: '600', fontSize: '9pt', border: '1px solid #c8c8c8' }}>{fmtPrint(rate, "$")}</td>
                              <td style={{ textAlign: 'center', padding: '4px 7px', verticalAlign: 'top', fontWeight: '600', fontSize: '9pt', border: '1px solid #c8c8c8' }}>{fmtPrint(qty * rate, "$")}</td>
                              <td style={{ textAlign: 'center', padding: '4px 7px', verticalAlign: 'top', fontWeight: '600', fontSize: '9pt', border: '1px solid #c8c8c8' }}>{fmtPrint(configPrice, "$")}</td>
                              <td style={{ textAlign: 'center', padding: '4px 7px', verticalAlign: 'top', fontWeight: '600', fontSize: '9pt', border: '1px solid #c8c8c8', color: plBaleColor }}>
                                {fmtPrint(plPerBale, "$")}
                              </td>
                              <td style={{ textAlign: 'center', padding: '4px 7px', verticalAlign: 'top', fontWeight: '600', fontSize: '9pt', border: '1px solid #c8c8c8', color: totalPLColor }}>
                                {fmtPrint(totalPL, "$")}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td style={{ padding: '4px 7px', fontWeight: '900', fontSize: '9pt', border: '1px solid #999', backgroundColor: '#eeeeee' }}>TOTAL</td>
                          <td style={{ textAlign: 'center', padding: '4px 7px', fontWeight: '900', fontSize: '9pt', border: '1px solid #999', backgroundColor: '#eeeeee' }}>{fmtPrint((voucherDetails?.salesItems ?? []).reduce((s, i) => s + parseFloat(i.quantity || "0"), 0))}</td>
                          <td style={{ padding: '4px 7px', border: '1px solid #999', backgroundColor: '#eeeeee' }}></td>
                          <td style={{ textAlign: 'center', padding: '4px 7px', fontWeight: '900', fontSize: '9pt', border: '1px solid #999', backgroundColor: '#eeeeee' }}>{fmtPrint((voucherDetails?.salesItems ?? []).reduce((s, i) => s + parseFloat(i.quantity || "0") * parseFloat(i.sellingPrice || "0"), 0), "$")}</td>
                          <td style={{ padding: '4px 7px', border: '1px solid #999', backgroundColor: '#eeeeee' }}></td>
                          <td style={{ padding: '4px 7px', border: '1px solid #999', backgroundColor: '#eeeeee' }}></td>
                          <td style={{ textAlign: 'center', padding: '4px 7px', fontWeight: '900', fontSize: '9pt', border: '1px solid #999', backgroundColor: '#eeeeee', color: (() => { const t = (voucherDetails?.salesItems ?? []).reduce((s, i) => s + (parseFloat(i.sellingPrice || "0") - parseFloat(i.configuredPrice || "0")) * parseFloat(i.quantity || "0"), 0); return t > 0 ? '#0a7e1f' : t < 0 ? '#c2272d' : undefined; })() }}>
                            {(() => {
                              const t = (voucherDetails?.salesItems ?? []).reduce((s, i) => s + (parseFloat(i.sellingPrice || "0") - parseFloat(i.configuredPrice || "0")) * parseFloat(i.quantity || "0"), 0);
                              return fmtPrint(t, "$");
                            })()}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                    {/* Total Paid */}
                    <div style={{ fontSize: '14pt', fontWeight: '900', marginTop: '8px', paddingTop: '8px', borderTop: '1.5px solid #333', display: 'flex', justifyContent: 'space-between' }}>
                      <span>TOTAL PAID:</span>
                      <span>{fmtPrint((voucherDetails?.salesItems ?? []).reduce((s, i) => s + parseFloat(i.quantity || "0") * parseFloat(i.sellingPrice || "0"), 0), "$")}</span>
                    </div>
                    {/* Notes */}
                    {voucherDetails?.description && (
                      <div style={{ fontSize: '9pt', fontWeight: '600', marginTop: '8px', padding: '4px', border: '2px solid black' }}>
                        <span style={{ fontWeight: '900' }}>Note:</span> {voucherDetails.description}
                      </div>
                    )}
                    {/* Footer */}
                    <div style={{ textAlign: 'center', fontSize: '9pt', fontWeight: '700', marginTop: '10px', paddingTop: '5px', borderTop: '2px solid black' }}>
                      <div>Thank you for your business!</div>
                    </div>
                  </div>
                </div>

                <Button variant="outline" onClick={() => setSelectedVoucher(null)} data-testid="button-close">
                  Close
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleReprint()}
                  disabled={!voucherDetails?.salesItems}
                  data-testid="button-reprint"
                >
                  <Printer className="h-4 w-4 mr-2" />
                  Reprint
                </Button>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <Button
                          onClick={handleEdit}
                          disabled={!canEditDaybook}
                          className={!canEditDaybook ? "opacity-50 cursor-not-allowed" : ""}
                          data-testid="button-edit-transaction"
                        >
                          {!canEditDaybook && <Lock className="h-4 w-4 mr-2" />}
                          {canEditDaybook && <Pencil className="h-4 w-4 mr-2" />}
                          Edit Transaction
                        </Button>
                      </div>
                    </TooltipTrigger>
                    {!canEditDaybook && (
                      <TooltipContent>
                        <p>You don't have permission to edit daybook transactions</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
