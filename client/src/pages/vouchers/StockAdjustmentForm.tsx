import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useAppMode, useModePrefix } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { queryClient } from "@/lib/queryClient";
import { formatNumber } from "@/lib/formatNumber";
import { utils, writeFile } from "@/lib/excelHelper";
import { parseDateLocal } from "@/components/vouchers/PrintTemplate";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { X, Plus, FileDown, ChevronDown, Search } from "lucide-react";

interface StockItem {
  id: number;
  code: string;
  name: string;
  uom: string;
}
interface Location {
  id: number;
  code?: string;
  name: string;
}

const stockAdjustmentEntrySchema = z.object({
  type: z.enum(["CONSUME", "PRODUCE"]),
  stockItemId: z.number().min(1, "Please select a stock item"),
  stockItemCode: z.string().default(""),
  stockItemName: z.string(),
  quantity: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) !== 0, "Quantity cannot be zero"),
  rate: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Rate must be non-negative"),
});
const stockAdjustmentFormSchema = z.object({
  voucherDate: z.date(),
  locationId: z.number().min(1, "Location required"),
  entries: z.array(stockAdjustmentEntrySchema).min(1, "At least one entry is required"),
  notes: z.string().optional(),
  optional: z.boolean().default(false),
});
type StockAdjustmentFormData = z.infer<typeof stockAdjustmentFormSchema>;

interface StockAdjustmentFormProps {
  voucherIdToEdit: number | null;
  isPOS: boolean;
}

export function StockAdjustmentForm({ voucherIdToEdit }: StockAdjustmentFormProps) {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const modePrefix = useModePrefix();
  const { formatAmount, selectedCurrency, exchangeRate } = useCurrencyContext();
  const [, setLocation] = useLocation();
  const hydratedVoucherIdRef = useRef<number | null>(null);

  const { data: stockItems = [] } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items", selectedCompany?.id],
  });
  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations", selectedCompany?.id],
  });

  const { data: voucherToEdit } = useQuery({
    queryKey: ["/api/vouchers", voucherIdToEdit],
    enabled: !!voucherIdToEdit,
    queryFn: async () => {
      const res = await fetch(`/api/vouchers/${voucherIdToEdit}`);
      if (!res.ok) throw new Error("Failed to fetch voucher");
      return res.json();
    },
  });

  const { data: stockAdjustmentToEdit } = useQuery({
    queryKey: ["/api/stock-adjustments", voucherIdToEdit],
    enabled: !!voucherIdToEdit,
    queryFn: async () => {
      const res = await fetch(`/api/stock-adjustments?voucherId=${voucherIdToEdit}`);
      if (!res.ok) throw new Error("Failed to fetch stock adjustment");
      const data = await res.json();
      return Array.isArray(data) ? data[0] : data;
    },
  });

  const stockAdjustmentForm = useForm<StockAdjustmentFormData>({
    resolver: zodResolver(stockAdjustmentFormSchema),
    defaultValues: {
      voucherDate: new Date(),
      locationId: 0,
      entries: [{ type: "CONSUME", stockItemId: 0, stockItemCode: "", stockItemName: "", quantity: "", rate: "" }],
      notes: "",
      optional: false,
    },
  });

  const {
    fields: adjustmentFields,
    append: appendAdjustment,
    remove: removeAdjustment,
  } = useFieldArray({
    control: stockAdjustmentForm.control,
    name: "entries",
  });

  const adjustmentEntries = stockAdjustmentForm.watch("entries") || [];
  const adjustmentLocationId = stockAdjustmentForm.watch("locationId") || 0;

  const consumptionTotal = adjustmentEntries
    .filter((e) => e.type === "CONSUME")
    .reduce((sum, e) => sum + parseFloat(e.quantity || "0") * parseFloat(e.rate || "0"), 0);
  const productionTotal = adjustmentEntries
    .filter((e) => e.type === "PRODUCE")
    .reduce((sum, e) => sum + parseFloat(e.quantity || "0") * parseFloat(e.rate || "0"), 0);
  const currentHasConsumption = adjustmentEntries.some((e) => e.type === "CONSUME");
  const currentHasProduction = adjustmentEntries.some((e) => e.type === "PRODUCE");
  const currentAdjustmentType =
    currentHasConsumption && currentHasProduction ? "Mixed" : currentHasProduction ? "Production" : "Consumption";
  const displayAdjustmentTotal =
    currentAdjustmentType === "Mixed" ? productionTotal - consumptionTotal : consumptionTotal + productionTotal;

  const { data: locationInventory = [] } = useQuery<any[]>({
    queryKey: ["/api/adjustment-location-inventory", adjustmentLocationId],
    enabled: adjustmentLocationId > 0,
    queryFn: async () => {
      const response = await fetch(`/api/locations/${adjustmentLocationId}/inventory`);
      if (!response.ok) throw new Error("Failed to fetch inventory");
      return response.json();
    },
  });

  const [adjustmentSearchTerm, setAdjustmentSearchTerm] = useState("");
  const [adjustmentHighlightedIndex, setAdjustmentHighlightedIndex] = useState(0);
  const [activeAdjustmentRow, setActiveAdjustmentRow] = useState<number | null>(null);
  const [showAdjustmentSidebar, setShowAdjustmentSidebar] = useState(false);
  const adjustmentFocusIdRef = useRef(0);
  const adjustmentSidebarRef = useRef<HTMLDivElement>(null);

  const adjustmentItemsWithInventory = useMemo(() => {
    if (!stockItems.length) return [];
    return stockItems
      .map((item) => {
        const inv = locationInventory.find((i: any) => i.stockItemId === item.id);
        return {
          stockItemId: item.id,
          stockItemCode: item.code,
          stockItemName: item.name,
          quantity: inv?.quantity || "0",
          averageRate: inv?.averageRate || "0",
        };
      })
      .sort((a, b) => a.stockItemName.localeCompare(b.stockItemName));
  }, [stockItems, locationInventory]);

  const filteredAdjustmentItems = useMemo(() => {
    if (!adjustmentSearchTerm.trim()) return adjustmentItemsWithInventory;
    const term = adjustmentSearchTerm.toLowerCase();
    return adjustmentItemsWithInventory.filter(
      (item) => item.stockItemName?.toLowerCase().includes(term) || item.stockItemCode?.toLowerCase().includes(term)
    );
  }, [adjustmentItemsWithInventory, adjustmentSearchTerm]);

  useEffect(() => {
    if (showAdjustmentSidebar && adjustmentSidebarRef.current) {
      const container = adjustmentSidebarRef.current;
      const highlighted = container.querySelector(`[data-adjustment-idx="${adjustmentHighlightedIndex}"]`);
      if (highlighted) highlighted.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [adjustmentHighlightedIndex, showAdjustmentSidebar]);

  useEffect(() => {
    if (stockAdjustmentToEdit && stockAdjustmentToEdit.items && voucherToEdit && stockItems.length > 0) {
      if (hydratedVoucherIdRef.current === voucherIdToEdit) return;
      const formEntries = stockAdjustmentToEdit.items.map((item: any) => {
        const stockItem = stockItems.find((s) => s.id === item.stockItemId);
        const quantity = parseFloat(item.quantity || "0");
        const type = quantity < 0 ? "CONSUME" : "PRODUCE";
        const absQuantity = Math.abs(quantity).toString();
        return {
          type,
          stockItemId: item.stockItemId || 0,
          stockItemCode: stockItem?.code || "",
          stockItemName: stockItem?.name || "",
          quantity: absQuantity,
          rate: item.rate || "0",
        };
      });
      stockAdjustmentForm.reset({
        voucherDate: voucherToEdit ? parseDateLocal(voucherToEdit.voucherDate) : new Date(),
        locationId: stockAdjustmentToEdit.locationId || 0,
        entries:
          formEntries.length > 0
            ? formEntries
            : [
                {
                  type: "PRODUCE",
                  stockItemId: 0,
                  stockItemCode: "",
                  stockItemName: "",
                  quantity: "",
                  rate: "",
                },
              ],
        notes: stockAdjustmentToEdit.notes || "",
        optional: voucherToEdit?.optional || false,
      });
      hydratedVoucherIdRef.current = voucherIdToEdit;
    }
  }, [stockAdjustmentToEdit, voucherToEdit, stockItems, stockAdjustmentForm]); // eslint-disable-line

  const stockAdjustmentMutation = useMutation({
    mutationFn: async (data: StockAdjustmentFormData) => {
      const isEditMode = !!voucherIdToEdit;
      const hasConsumption = data.entries.some((e) => e.type === "CONSUME");
      const hasProduction = data.entries.some((e) => e.type === "PRODUCE");
      const adjustmentType = hasConsumption && hasProduction ? "Mixed" : hasProduction ? "Production" : "Consumption";
      const items = data.entries.map((entry) => ({
        stockItemId: entry.stockItemId,
        quantity: entry.type === "CONSUME" ? (-parseFloat(entry.quantity)).toString() : entry.quantity,
        rate: entry.rate,
      }));
      const localConsumptionTotal = data.entries
        .filter((e) => e.type === "CONSUME")
        .reduce((s, e) => s + parseFloat(e.quantity || "0") * parseFloat(e.rate || "0"), 0);
      const localProductionTotal = data.entries
        .filter((e) => e.type === "PRODUCE")
        .reduce((s, e) => s + parseFloat(e.quantity || "0") * parseFloat(e.rate || "0"), 0);
      const totalAmount =
        adjustmentType === "Mixed"
          ? localProductionTotal - localConsumptionTotal
          : localConsumptionTotal + localProductionTotal;

      if (isEditMode) {
        const voucherRes = await modeApiRequest("PATCH", `/api/vouchers/${voucherIdToEdit}`, {
          voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
          description: `Stock ${adjustmentType.toLowerCase()} at ${locations.find((l) => l.id === data.locationId)?.name}`,
          totalAmount: totalAmount.toString(),
          optional: data.optional,
        });
        if (stockAdjustmentToEdit?.id) {
          await modeApiRequest("PUT", `/api/stock-adjustments/${stockAdjustmentToEdit.id}`, {
            locationId: data.locationId,
            adjustmentType,
            notes: data.notes || "",
            items,
          });
        }
        return await voucherRes.json();
      } else {
        const voucherRes = await modeApiRequest("POST", "/api/vouchers", {
          companyId: selectedCompany?.id,
          voucherType: adjustmentType,
          voucherNumber: `${adjustmentType.toUpperCase()}-${Date.now()}`,
          voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
          description: `Stock ${adjustmentType.toLowerCase()} at ${locations.find((l) => l.id === data.locationId)?.name}`,
          totalAmount: totalAmount.toString(),
          optional: data.optional,
          currency: selectedCurrency,
          exchangeRate: exchangeRate ? exchangeRate.toString() : undefined,
        });
        const voucher = await voucherRes.json();
        await modeApiRequest("POST", "/api/stock-adjustments", {
          voucherId: voucher.id,
          locationId: data.locationId,
          adjustmentType,
          notes: data.notes || "",
          items,
        });
        return voucher;
      }
    },
    onSuccess: () => {
      const isEditMode = !!voucherIdToEdit;
      toast({
        title: "Success",
        description: `Production/Consumption voucher ${isEditMode ? "updated" : "created"} successfully`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-by-location"] });
      queryClient.invalidateQueries({ queryKey: ["/api/location-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-adjustments"] });
      if (isEditMode) {
        setLocation(`${modePrefix}/daybook`);
      } else {
        stockAdjustmentForm.reset({
          voucherDate: new Date(),
          locationId: 0,
          entries: [{ type: "PRODUCE", stockItemId: 0, stockItemCode: "", stockItemName: "", quantity: "", rate: "" }],
          notes: "",
        });
      }
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || `Failed to ${voucherIdToEdit ? "update" : "create"} stock adjustment`,
        variant: "destructive",
      });
    },
  });

  const handleExportProductionConsumptionVoucher = async (detailed: boolean) => {
    const formData = stockAdjustmentForm.getValues();
    const voucherDate = formData.voucherDate
      ? format(formData.voucherDate, "yyyy-MM-dd")
      : format(new Date(), "yyyy-MM-dd");
    const validEntries = formData.entries.filter((e: any) => e.stockItemId > 0 && parseFloat(e.quantity) > 0);
    if (validEntries.length === 0) {
      toast({
        title: "No data to export",
        description: "Add at least one entry before exporting.",
        variant: "destructive",
      });
      return;
    }
    const locationName = locations.find((l: any) => l.id === formData.locationId)?.name || "";
    if (detailed) {
      const exportData = validEntries.map((entry: any) => ({
        "Entry Type": entry.type?.toUpperCase() === "CONSUME" ? "Consumption" : "Production",
        Date: voucherDate,
        Location: locationName,
        "Item Code": entry.stockItemCode || "",
        "Item Name": entry.stockItemName || "",
        Quantity: parseFloat(entry.quantity).toFixed(2),
        Rate: parseFloat(entry.rate || "0").toFixed(2),
        Amount: (parseFloat(entry.quantity) * parseFloat(entry.rate || "0")).toFixed(2),
        Notes: formData.notes || "",
        Optional: formData.optional ? "Yes" : "No",
      }));
      const worksheet = utils.json_to_sheet(exportData);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Production-Consumption Detailed");
      const fileName = `Production_Consumption_Detailed_${voucherDate}.xlsx`;
      await writeFile(workbook, fileName);
      toast({ title: "Export successful", description: `Downloaded ${fileName} with ${validEntries.length} items.` });
    } else {
      const consumeTotal = validEntries
        .filter((e: any) => e.type?.toUpperCase() === "CONSUME")
        .reduce((sum: number, e: any) => sum + parseFloat(e.quantity) * parseFloat(e.rate || "0"), 0);
      const produceTotal = validEntries
        .filter((e: any) => e.type?.toUpperCase() === "PRODUCE")
        .reduce((sum: number, e: any) => sum + parseFloat(e.quantity) * parseFloat(e.rate || "0"), 0);
      const exportData = [
        {
          "Voucher Type": "Production/Consumption",
          Date: voucherDate,
          Location: locationName,
          "Consumption Total": consumeTotal.toFixed(2),
          "Production Total": produceTotal.toFixed(2),
          "Number of Items": validEntries.length,
          Notes: formData.notes || "",
          Optional: formData.optional ? "Yes" : "No",
        },
      ];
      const worksheet = utils.json_to_sheet(exportData);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Production-Consumption Summary");
      const fileName = `Production_Consumption_Summary_${voucherDate}.xlsx`;
      await writeFile(workbook, fileName);
      toast({ title: "Export successful", description: `Downloaded ${fileName}.` });
    }
  };

  const onStockAdjustmentSubmit = async (data: StockAdjustmentFormData) => {
    const validEntries = data.entries.filter((e) => e.stockItemId > 0 && parseFloat(e.quantity) > 0);
    if (validEntries.length === 0) {
      toast({ title: "Validation Error", description: "Please add at least one valid entry", variant: "destructive" });
      return;
    }
    stockAdjustmentMutation.mutate(data);
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="p-5">
          <div className="flex items-center gap-2 mb-5">
            <span className="text-sm font-semibold">Production / Consumption Voucher</span>
          </div>
          <Form {...stockAdjustmentForm}>
            <form noValidate onSubmit={stockAdjustmentForm.handleSubmit(onStockAdjustmentSubmit)} className="space-y-6">
              {/* Header Row */}
              <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                <FormField
                  control={stockAdjustmentForm.control}
                  name="locationId"
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormLabel>Location</FormLabel>
                      <Select
                        value={field.value > 0 ? field.value.toString() : ""}
                        onValueChange={(v) => field.onChange(parseInt(v))}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-adjustment-location">
                            <SelectValue placeholder="Select location..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {[...locations]
                            .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                            .map((loc) => (
                              <SelectItem key={loc.id} value={loc.id.toString()}>
                                {loc.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={stockAdjustmentForm.control}
                  name="voucherDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          value={
                            field.value instanceof Date
                              ? format(field.value, "yyyy-MM-dd")
                              : typeof field.value === "string"
                                ? field.value
                                : ""
                          }
                          onChange={(e) =>
                            field.onChange(e.target.value ? new Date(e.target.value + "T00:00:00") : new Date())
                          }
                          className="w-full sm:w-[200px]"
                          data-testid="input-adjustment-date"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Unified Production/Consumption Table + Sidebar */}
              <div className="flex flex-col lg:flex-row gap-4">
                <Card className="flex-1 overflow-hidden min-w-0">
                  {/* Mobile: card-per-row */}
                  <div className="sm:hidden p-3 space-y-2">
                    {adjustmentFields.map((field, index) => {
                      const currentEntry = adjustmentEntries[index];
                      const inventoryItem = adjustmentItemsWithInventory.find(
                        (item) => item.stockItemId === currentEntry?.stockItemId
                      );
                      const availableQty = inventoryItem?.quantity || "0";
                      const rowAmount =
                        parseFloat(currentEntry?.quantity || "0") * parseFloat(currentEntry?.rate || "0");
                      const mobileAdjItems = activeAdjustmentRow === index ? filteredAdjustmentItems.slice(0, 10) : [];
                      return (
                        <div key={field.id} className="border rounded-md p-3 space-y-2 bg-card">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground font-medium">#{index + 1}</span>
                            {adjustmentFields.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => removeAdjustment(index)}
                                className="h-7 w-7"
                                data-testid={`button-remove-adjustment-mobile-${index}`}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground">Type (P/C)</label>
                              <input
                                type="text"
                                value={
                                  currentEntry?.type === "PRODUCE"
                                    ? "Produce"
                                    : currentEntry?.type === "CONSUME"
                                      ? "Consume"
                                      : ""
                                }
                                onChange={(e) => {
                                  const val = e.target.value.toLowerCase();
                                  if (val.startsWith("p"))
                                    stockAdjustmentForm.setValue(`entries.${index}.type`, "PRODUCE");
                                  else if (val.startsWith("c"))
                                    stockAdjustmentForm.setValue(`entries.${index}.type`, "CONSUME");
                                }}
                                placeholder="p / c"
                                data-testid={`input-adjustment-type-mobile-${index}`}
                                className="w-full px-3 py-2 text-sm border rounded-md bg-background outline-none focus:ring-1 focus:ring-ring"
                              />
                            </div>
                            {currentEntry?.stockItemId > 0 && (
                              <div className="space-y-1">
                                <label className="text-xs text-muted-foreground">Available</label>
                                <div className="px-3 py-2 text-sm font-mono text-muted-foreground">
                                  {formatNumber(parseFloat(availableQty))}
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Item</label>
                            <input
                              type="text"
                              value={
                                activeAdjustmentRow === index ? adjustmentSearchTerm : currentEntry?.stockItemName || ""
                              }
                              onChange={(e) => {
                                setAdjustmentSearchTerm(e.target.value);
                                setAdjustmentHighlightedIndex(0);
                                if (!e.target.value) {
                                  stockAdjustmentForm.setValue(`entries.${index}.stockItemId`, 0);
                                  stockAdjustmentForm.setValue(`entries.${index}.stockItemCode`, "");
                                  stockAdjustmentForm.setValue(`entries.${index}.stockItemName`, "");
                                }
                              }}
                              onFocus={() => {
                                adjustmentFocusIdRef.current += 1;
                                setActiveAdjustmentRow(index);
                                setAdjustmentSearchTerm(currentEntry?.stockItemName || "");
                                setAdjustmentHighlightedIndex(0);
                                setShowAdjustmentSidebar(true);
                              }}
                              onBlur={() => {
                                const focusId = adjustmentFocusIdRef.current;
                                setTimeout(() => {
                                  if (adjustmentFocusIdRef.current === focusId) {
                                    setActiveAdjustmentRow(null);
                                    setAdjustmentSearchTerm("");
                                    setShowAdjustmentSidebar(false);
                                  }
                                }, 200);
                              }}
                              placeholder="Type to search item..."
                              data-testid={`input-adjustment-item-mobile-${index}`}
                              className="w-full px-3 py-2 text-sm border rounded-md bg-background outline-none focus:ring-1 focus:ring-ring"
                            />
                            {mobileAdjItems.length > 0 && (
                              <div className="border rounded-md bg-popover shadow-md max-h-40 overflow-y-auto z-20 relative">
                                {mobileAdjItems.map((item: any) => (
                                  <button
                                    key={item.stockItemId}
                                    type="button"
                                    className="w-full text-left px-3 py-2 text-sm hover-elevate border-b last:border-b-0"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      stockAdjustmentForm.setValue(`entries.${index}.stockItemId`, item.stockItemId);
                                      stockAdjustmentForm.setValue(
                                        `entries.${index}.stockItemCode`,
                                        item.stockItemCode || ""
                                      );
                                      stockAdjustmentForm.setValue(
                                        `entries.${index}.stockItemName`,
                                        item.stockItemName
                                      );
                                      stockAdjustmentForm.setValue(`entries.${index}.rate`, item.averageRate || "0");
                                      setAdjustmentSearchTerm("");
                                      setShowAdjustmentSidebar(false);
                                    }}
                                  >
                                    <div className="font-medium truncate">{item.stockItemName}</div>
                                    <div className="text-xs text-muted-foreground">
                                      Avail: {formatNumber(item.quantity)}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground">Qty</label>
                              <input
                                type="number"
                                step="0.001"
                                value={currentEntry?.quantity || ""}
                                onChange={(e) =>
                                  stockAdjustmentForm.setValue(`entries.${index}.quantity`, e.target.value)
                                }
                                placeholder="0"
                                data-testid={`input-adjustment-qty-mobile-${index}`}
                                className="w-full px-3 py-2 text-sm border rounded-md bg-background outline-none focus:ring-1 focus:ring-ring font-mono text-right"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground">Rate</label>
                              <input
                                type="number"
                                step="0.01"
                                value={currentEntry?.rate || ""}
                                onChange={(e) => stockAdjustmentForm.setValue(`entries.${index}.rate`, e.target.value)}
                                placeholder="0.00"
                                data-testid={`input-adjustment-rate-mobile-${index}`}
                                className="w-full px-3 py-2 text-sm border rounded-md bg-background outline-none focus:ring-1 focus:ring-ring font-mono text-right"
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-between px-1">
                            <span className="text-xs text-muted-foreground">Amount</span>
                            <span
                              className={`text-sm font-mono font-medium ${currentEntry?.type === "CONSUME" ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}
                            >
                              {currentEntry?.type === "CONSUME" ? "-" : "+"}
                              {formatAmount(rowAmount)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex items-center justify-between pt-1 px-0.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          appendAdjustment({
                            type: "CONSUME",
                            stockItemId: 0,
                            stockItemCode: "",
                            stockItemName: "",
                            quantity: "",
                            rate: "",
                          })
                        }
                        data-testid="button-add-adjustment-row-mobile"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Row
                      </Button>
                      <div className="text-right text-xs space-y-0.5">
                        <div>
                          <span className="text-muted-foreground">Consume: </span>
                          <span className="text-destructive font-mono">{formatAmount(consumptionTotal)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Produce: </span>
                          <span className="text-emerald-600 font-mono">{formatAmount(productionTotal)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Desktop: spreadsheet */}
                  <div className="hidden sm:block overflow-x-auto">
                    <div className="min-w-[400px]">
                      <div className="flex bg-muted/50 border-b sticky top-0 z-30">
                        <div className="w-10 sm:w-12 flex items-center justify-center border-r h-9 sm:h-10 font-medium text-xs">
                          #
                        </div>
                        <div className="w-16 sm:w-24 flex items-center px-2 sm:px-3 border-r h-9 sm:h-10 font-medium text-xs sm:text-sm">
                          Type
                        </div>
                        <div className="flex-1 min-w-[120px] flex items-center px-2 sm:px-3 border-r h-9 sm:h-10 font-medium text-xs sm:text-sm">
                          Item
                        </div>
                        <div className="w-16 sm:w-20 flex items-center px-2 sm:px-3 border-r h-9 sm:h-10 font-medium text-xs sm:text-sm text-muted-foreground">
                          Avail
                        </div>
                        <div className="w-16 sm:w-24 flex items-center px-2 sm:px-3 border-r h-9 sm:h-10 font-medium text-xs sm:text-sm">
                          Qty
                        </div>
                        <div className="w-16 sm:w-24 flex items-center px-2 sm:px-3 border-r h-9 sm:h-10 font-medium text-xs sm:text-sm">
                          Rate
                        </div>
                        <div className="w-20 sm:w-28 flex items-center px-2 sm:px-3 border-r h-9 sm:h-10 font-medium text-xs sm:text-sm bg-muted/30">
                          Amt
                        </div>
                        <div className="w-10 sm:w-12 flex items-center justify-center h-9 sm:h-10" />
                      </div>
                      <div className="max-h-[calc(100vh-24rem)] overflow-y-auto">
                        {adjustmentFields.map((field, index) => {
                          const currentEntry = adjustmentEntries[index];
                          const inventoryItem = adjustmentItemsWithInventory.find(
                            (item) => item.stockItemId === currentEntry?.stockItemId
                          );
                          const availableQty = inventoryItem?.quantity || "0";
                          return (
                            <div key={field.id} className="flex border-b hover-elevate">
                              <div className="w-10 sm:w-12 flex items-center justify-center border-r h-9 sm:h-10 text-xs text-muted-foreground">
                                {index + 1}
                              </div>
                              <div className="w-16 sm:w-24 border-r h-9 sm:h-10">
                                <input
                                  type="text"
                                  value={
                                    currentEntry?.type === "PRODUCE"
                                      ? "Produce"
                                      : currentEntry?.type === "CONSUME"
                                        ? "Consume"
                                        : ""
                                  }
                                  onChange={(e) => {
                                    const val = e.target.value.toLowerCase();
                                    if (val.startsWith("p"))
                                      stockAdjustmentForm.setValue(`entries.${index}.type`, "PRODUCE");
                                    else if (val.startsWith("c"))
                                      stockAdjustmentForm.setValue(`entries.${index}.type`, "CONSUME");
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "p" || e.key === "P") {
                                      e.preventDefault();
                                      stockAdjustmentForm.setValue(`entries.${index}.type`, "PRODUCE");
                                    } else if (e.key === "c" || e.key === "C") {
                                      e.preventDefault();
                                      stockAdjustmentForm.setValue(`entries.${index}.type`, "CONSUME");
                                    } else if (e.key === "Tab" && !e.shiftKey) {
                                      e.preventDefault();
                                      const item = document.querySelector(
                                        `[data-testid="input-adjustment-item-${index}"]`
                                      ) as HTMLInputElement;
                                      if (item) {
                                        item.focus();
                                        item.select();
                                      }
                                    } else if (e.key === "ArrowDown") {
                                      e.preventDefault();
                                      const next = document.querySelector(
                                        `[data-testid="input-adjustment-type-${index + 1}"]`
                                      ) as HTMLInputElement;
                                      if (next) next.focus();
                                    } else if (e.key === "ArrowUp" && index > 0) {
                                      e.preventDefault();
                                      const prev = document.querySelector(
                                        `[data-testid="input-adjustment-type-${index - 1}"]`
                                      ) as HTMLInputElement;
                                      if (prev) prev.focus();
                                    }
                                  }}
                                  placeholder="p/c"
                                  className="w-full h-full px-3 bg-transparent outline-none focus:bg-accent/20 text-sm"
                                  data-testid={`input-adjustment-type-${index}`}
                                />
                              </div>
                              <div className="flex-1 min-w-[120px] border-r h-9 sm:h-10">
                                <input
                                  type="text"
                                  value={
                                    activeAdjustmentRow === index
                                      ? adjustmentSearchTerm
                                      : currentEntry?.stockItemName || ""
                                  }
                                  onChange={(e) => {
                                    setAdjustmentSearchTerm(e.target.value);
                                    setAdjustmentHighlightedIndex(0);
                                    if (!e.target.value) {
                                      stockAdjustmentForm.setValue(`entries.${index}.stockItemId`, 0);
                                      stockAdjustmentForm.setValue(`entries.${index}.stockItemCode`, "");
                                      stockAdjustmentForm.setValue(`entries.${index}.stockItemName`, "");
                                    }
                                  }}
                                  onFocus={() => {
                                    adjustmentFocusIdRef.current += 1;
                                    setActiveAdjustmentRow(index);
                                    setAdjustmentSearchTerm(currentEntry?.stockItemName || "");
                                    setAdjustmentHighlightedIndex(0);
                                    setShowAdjustmentSidebar(true);
                                  }}
                                  onBlur={() => {
                                    const focusIdAtBlur = adjustmentFocusIdRef.current;
                                    setTimeout(() => {
                                      if (adjustmentFocusIdRef.current === focusIdAtBlur) {
                                        setActiveAdjustmentRow(null);
                                        setAdjustmentSearchTerm("");
                                        setShowAdjustmentSidebar(false);
                                      }
                                    }, 200);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "ArrowUp" && !e.shiftKey) {
                                      e.preventDefault();
                                      if (showAdjustmentSidebar && filteredAdjustmentItems.length > 0)
                                        setAdjustmentHighlightedIndex(Math.max(0, adjustmentHighlightedIndex - 1));
                                      else if (index > 0) {
                                        const prev = document.querySelector(
                                          `[data-testid="input-adjustment-item-${index - 1}"]`
                                        ) as HTMLInputElement;
                                        if (prev) prev.focus();
                                      }
                                    } else if (e.key === "ArrowDown" && !e.shiftKey) {
                                      e.preventDefault();
                                      if (showAdjustmentSidebar && filteredAdjustmentItems.length > 0)
                                        setAdjustmentHighlightedIndex(
                                          Math.min(filteredAdjustmentItems.length - 1, adjustmentHighlightedIndex + 1)
                                        );
                                      else if (index < adjustmentFields.length - 1) {
                                        const next = document.querySelector(
                                          `[data-testid="input-adjustment-item-${index + 1}"]`
                                        ) as HTMLInputElement;
                                        if (next) next.focus();
                                      }
                                    } else if (e.key === "Enter") {
                                      e.preventDefault();
                                      if (showAdjustmentSidebar && filteredAdjustmentItems.length > 0) {
                                        const item = filteredAdjustmentItems[adjustmentHighlightedIndex];
                                        if (item) {
                                          stockAdjustmentForm.setValue(
                                            `entries.${index}.stockItemId`,
                                            item.stockItemId
                                          );
                                          stockAdjustmentForm.setValue(
                                            `entries.${index}.stockItemCode`,
                                            item.stockItemCode || ""
                                          );
                                          stockAdjustmentForm.setValue(
                                            `entries.${index}.stockItemName`,
                                            item.stockItemName
                                          );
                                          stockAdjustmentForm.setValue(
                                            `entries.${index}.rate`,
                                            item.averageRate || "0"
                                          );
                                          setAdjustmentSearchTerm("");
                                          setShowAdjustmentSidebar(false);
                                          setTimeout(() => {
                                            const qty = document.querySelector(
                                              `[data-testid="input-adjustment-qty-${index}"]`
                                            ) as HTMLInputElement;
                                            if (qty) {
                                              qty.focus();
                                              qty.select();
                                            }
                                          }, 50);
                                        }
                                      }
                                    } else if (e.key === "Tab" && !e.shiftKey) {
                                      e.preventDefault();
                                      setShowAdjustmentSidebar(false);
                                      const qty = document.querySelector(
                                        `[data-testid="input-adjustment-qty-${index}"]`
                                      ) as HTMLInputElement;
                                      if (qty) {
                                        qty.focus();
                                        qty.select();
                                      }
                                    }
                                  }}
                                  placeholder="Type to search..."
                                  className="w-full h-full px-3 bg-transparent outline-none focus:bg-accent/20"
                                  data-testid={`input-adjustment-item-${index}`}
                                />
                              </div>
                              <div className="w-16 sm:w-20 border-r h-9 sm:h-10 bg-muted/20 flex items-center justify-end px-2 sm:px-3 font-mono text-xs sm:text-sm text-muted-foreground">
                                {formatNumber(parseFloat(availableQty))}
                              </div>
                              <div className="w-16 sm:w-24 border-r h-9 sm:h-10">
                                <input
                                  type="number"
                                  step="0.001"
                                  value={currentEntry?.quantity || ""}
                                  onChange={(e) =>
                                    stockAdjustmentForm.setValue(`entries.${index}.quantity`, e.target.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
                                      e.preventDefault();
                                      const rate = document.querySelector(
                                        `[data-testid="input-adjustment-rate-${index}"]`
                                      ) as HTMLInputElement;
                                      if (rate) {
                                        rate.focus();
                                        rate.select();
                                      }
                                    } else if (e.key === "ArrowDown") {
                                      e.preventDefault();
                                      const next = document.querySelector(
                                        `[data-testid="input-adjustment-qty-${index + 1}"]`
                                      ) as HTMLInputElement;
                                      if (next) next.focus();
                                    } else if (e.key === "ArrowUp" && index > 0) {
                                      e.preventDefault();
                                      const prev = document.querySelector(
                                        `[data-testid="input-adjustment-qty-${index - 1}"]`
                                      ) as HTMLInputElement;
                                      if (prev) prev.focus();
                                    }
                                  }}
                                  placeholder="0"
                                  className="w-full h-full px-3 bg-transparent outline-none focus:bg-accent/20 font-mono text-right"
                                  data-testid={`input-adjustment-qty-${index}`}
                                />
                              </div>
                              <div className="w-16 sm:w-24 border-r h-9 sm:h-10">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={currentEntry?.rate || ""}
                                  onChange={(e) =>
                                    stockAdjustmentForm.setValue(`entries.${index}.rate`, e.target.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      if (index === adjustmentFields.length - 1) {
                                        appendAdjustment({
                                          type: "CONSUME",
                                          stockItemId: 0,
                                          stockItemCode: "",
                                          stockItemName: "",
                                          quantity: "",
                                          rate: "",
                                        });
                                        setTimeout(() => {
                                          const next = document.querySelector(
                                            `[data-testid="input-adjustment-type-${index + 1}"]`
                                          ) as HTMLInputElement;
                                          if (next) next.focus();
                                        }, 100);
                                      } else {
                                        const next = document.querySelector(
                                          `[data-testid="input-adjustment-type-${index + 1}"]`
                                        ) as HTMLInputElement;
                                        if (next) next.focus();
                                      }
                                    } else if (e.key === "ArrowDown") {
                                      e.preventDefault();
                                      const next = document.querySelector(
                                        `[data-testid="input-adjustment-rate-${index + 1}"]`
                                      ) as HTMLInputElement;
                                      if (next) next.focus();
                                    } else if (e.key === "ArrowUp" && index > 0) {
                                      e.preventDefault();
                                      const prev = document.querySelector(
                                        `[data-testid="input-adjustment-rate-${index - 1}"]`
                                      ) as HTMLInputElement;
                                      if (prev) prev.focus();
                                    }
                                  }}
                                  placeholder="0"
                                  className="w-full h-full px-3 bg-transparent outline-none focus:bg-accent/20 font-mono text-right"
                                  data-testid={`input-adjustment-rate-${index}`}
                                />
                              </div>
                              <div className="w-20 sm:w-28 border-r h-9 sm:h-10 bg-muted/30 flex items-center justify-end px-2 sm:px-3 font-mono text-xs sm:text-sm">
                                {formatAmount(
                                  parseFloat(currentEntry?.quantity || "0") * parseFloat(currentEntry?.rate || "0")
                                )}
                              </div>
                              <div className="w-10 sm:w-12 flex items-center justify-center h-9 sm:h-10">
                                {adjustmentFields.length > 1 && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeAdjustment(index)}
                                    className="h-8 w-8"
                                    data-testid={`button-remove-adjustment-${index}`}
                                  >
                                    <X className="h-4 w-4 text-destructive" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Total Section */}
                  <div className="border-t bg-muted/20 p-4">
                    <div className="flex flex-wrap justify-between items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          appendAdjustment({
                            type: "CONSUME",
                            stockItemId: 0,
                            stockItemCode: "",
                            stockItemName: "",
                            quantity: "",
                            rate: "",
                          })
                        }
                        data-testid="button-add-adjustment-row"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Row
                      </Button>
                      <div className="flex flex-wrap items-center gap-2 sm:gap-6">
                        <div className="text-xs text-muted-foreground">Total Qty:</div>
                        <div className="text-xs font-mono font-medium">
                          {formatNumber(adjustmentEntries.reduce((sum, e) => sum + parseFloat(e.quantity || "0"), 0))}
                        </div>
                        <div className="text-xs text-muted-foreground">Consume:</div>
                        <div className="text-xs font-mono font-medium text-destructive">
                          {formatAmount(consumptionTotal)}
                        </div>
                        <div className="text-xs text-muted-foreground">Produce:</div>
                        <div className="text-xs font-mono font-medium text-green-600">
                          {formatAmount(productionTotal)}
                        </div>
                        <div className="text-sm font-semibold">Total:</div>
                        <div className="text-sm font-bold font-mono" data-testid="text-adjustment-total">
                          {formatAmount(displayAdjustmentTotal)}
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>

                {/* Item Search Sidebar */}
                {showAdjustmentSidebar && (
                  <Card className="hidden sm:flex flex-col w-full lg:w-80 lg:sticky lg:top-4 max-h-[60vh] lg:max-h-[calc(100vh-12rem)] self-start">
                    <div className="p-4 border-b">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <h3 className="text-sm font-semibold">Search Items</h3>
                        <button
                          onClick={() => setShowAdjustmentSidebar(false)}
                          className="text-xs text-muted-foreground hover:text-foreground"
                          data-testid="button-close-adjustment-sidebar"
                        >
                          ✕
                        </button>
                      </div>
                      {adjustmentLocationId > 0 && (
                        <p className="text-xs text-muted-foreground mb-3">
                          {locations.find((l) => l.id === adjustmentLocationId)?.name}
                        </p>
                      )}
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search by name or code..."
                          value={adjustmentSearchTerm}
                          onChange={(e) => {
                            setAdjustmentSearchTerm(e.target.value);
                            setAdjustmentHighlightedIndex(0);
                          }}
                          className="pl-9"
                          data-testid="input-adjustment-sidebar-search"
                        />
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2" ref={adjustmentSidebarRef}>
                      <div className="space-y-1">
                        {filteredAdjustmentItems.length === 0 ? (
                          <div className="text-center py-8 text-sm text-muted-foreground">
                            {adjustmentLocationId > 0 ? "No items found" : "Select a location first"}
                          </div>
                        ) : (
                          filteredAdjustmentItems.map((item, idx) => {
                            const stock = parseFloat(item.quantity || "0");
                            const isHighlighted = idx === adjustmentHighlightedIndex && activeAdjustmentRow !== null;
                            return (
                              <button
                                key={item.stockItemId}
                                type="button"
                                data-adjustment-idx={idx}
                                className={`w-full text-left px-3 py-3 rounded-md hover-elevate active-elevate-2 ${stock === 0 ? "opacity-60" : ""} ${isHighlighted ? "bg-accent" : ""}`}
                                data-testid={`button-adjustment-suggest-item-${item.stockItemId}`}
                                onClick={() => {
                                  if (activeAdjustmentRow !== null) {
                                    stockAdjustmentForm.setValue(
                                      `entries.${activeAdjustmentRow}.stockItemId`,
                                      item.stockItemId
                                    );
                                    stockAdjustmentForm.setValue(
                                      `entries.${activeAdjustmentRow}.stockItemCode`,
                                      item.stockItemCode || ""
                                    );
                                    stockAdjustmentForm.setValue(
                                      `entries.${activeAdjustmentRow}.stockItemName`,
                                      item.stockItemName
                                    );
                                    stockAdjustmentForm.setValue(
                                      `entries.${activeAdjustmentRow}.rate`,
                                      item.averageRate || "0"
                                    );
                                    setAdjustmentSearchTerm("");
                                    setShowAdjustmentSidebar(false);
                                    setTimeout(() => {
                                      const qty = document.querySelector(
                                        `[data-testid="input-adjustment-qty-${activeAdjustmentRow}"]`
                                      ) as HTMLInputElement;
                                      if (qty) {
                                        qty.focus();
                                        qty.select();
                                      }
                                    }, 50);
                                  }
                                }}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium text-sm truncate">{item.stockItemName}</div>
                                    <div className="text-xs text-muted-foreground">{item.stockItemCode}</div>
                                  </div>
                                  <div className="text-right">
                                    <div
                                      className={`text-sm font-mono ${stock > 0 ? "text-green-600" : "text-muted-foreground"}`}
                                    >
                                      {formatNumber(stock)}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      @{formatAmount(parseFloat(item.averageRate || "0"))}
                                    </div>
                                  </div>
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </Card>
                )}
              </div>

              {/* Notes */}
              <FormField
                control={stockAdjustmentForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Additional notes..."
                        rows={3}
                        data-testid="input-adjustment-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Optional */}
              <FormField
                control={stockAdjustmentForm.control}
                name="optional"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-adjustment-optional"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Mark as Optional</FormLabel>
                    </div>
                  </FormItem>
                )}
              />

              {/* Footer Actions */}
              <div className="flex flex-wrap justify-end gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        adjustmentEntries.filter((e: any) => e.stockItemId > 0 && parseFloat(e.quantity) > 0).length ===
                        0
                      }
                      data-testid="button-export-production-consumption"
                    >
                      <FileDown className="h-4 w-4 mr-2" />
                      Export
                      <ChevronDown className="h-4 w-4 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => handleExportProductionConsumptionVoucher(false)}
                      data-testid="export-prod-cons-summary"
                    >
                      Summary Export
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleExportProductionConsumptionVoucher(true)}
                      data-testid="export-prod-cons-detailed"
                    >
                      Detailed Export
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  type="submit"
                  disabled={stockAdjustmentMutation.isPending || adjustmentEntries.length === 0}
                  data-testid="button-save-adjustment-voucher"
                >
                  {stockAdjustmentMutation.isPending ? "Saving..." : "Save Production/Consumption Voucher"}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </Card>
    </div>
  );
}
