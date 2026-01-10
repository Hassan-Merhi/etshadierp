import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { formatNumber } from "@/lib/formatNumber";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, Plus, Trash2, Search, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { AccountAutocomplete } from "@/components/AccountAutocomplete";
import type { CombinedAccount } from "@/components/AccountAutocomplete";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

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
  items: StockItemData[];
}

interface LocationSummaryResponse {
  stockGroups: StockGroupData[];
}

interface Location {
  id: number;
  code?: string;
  name: string;
}

interface CreditNoteItem {
  stockItemId: number;
  stockItemName: string;
  locationId: number;
  locationName: string;
  quantity: string;
  refundRate: string;
  inventoryCost: string;
  uom: string;
}

const creditNoteSchema = z.object({
  noteType: z.enum(["Credit Note", "Debit Note"]),
  voucherDate: z.string().min(1, "Date is required"),
  cashAccountType: z.string().min(1, "Account type is required"),
  cashAccountId: z.number().min(1, "Cash/Bank account is required"),
  cashAccountName: z.string().optional(),
  description: z.string().optional(),
});

type CreditNoteFormData = z.infer<typeof creditNoteSchema>;

interface CreditNoteTabProps {
  allAccounts: CombinedAccount[];
}

export function CreditNoteTab({ allAccounts }: CreditNoteTabProps) {
  const { toast } = useToast();
  const { formatDisplayDate } = useDateFormat();
  const [items, setItems] = useState<CreditNoteItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState<number>(0);
  const [selectedItem, setSelectedItem] = useState<StockItemData | null>(null);
  const [itemQuantity, setItemQuantity] = useState("");
  const [refundRate, setRefundRate] = useState("");
  const [inventoryCost, setInventoryCost] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<CreditNoteFormData>({
    resolver: zodResolver(creditNoteSchema),
    defaultValues: {
      noteType: "Credit Note",
      voucherDate: format(new Date(), "yyyy-MM-dd"),
      cashAccountType: "",
      cashAccountId: 0,
      cashAccountName: "",
      description: "",
    },
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const locationIds = locations.map((l) => l.id).join(",");

  const { data: summaryData } = useQuery<LocationSummaryResponse>({
    queryKey: ["/api/location-summary", locationIds],
    enabled: locationIds.length > 0,
  });

  const allStockItems: StockItemData[] = summaryData?.stockGroups.flatMap((g) => g.items) || [];

  const filteredItems = searchTerm.length > 0
    ? allStockItems.filter((item) =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.code.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : [];

  useEffect(() => {
    if (selectedItem && selectedLocationId > 0) {
      const locData = selectedItem.locationData[selectedLocationId];
      if (locData) {
        setInventoryCost(locData.rate.toFixed(2));
      } else {
        setInventoryCost("0.00");
      }
    }
  }, [selectedItem, selectedLocationId]);

  const createCreditNoteMutation = useMutation({
    mutationFn: async (data: {
      noteType: string;
      voucherDate: string;
      cashAccountId: number;
      cashAccountType: string;
      description: string;
      items: Array<{
        stockItemId: number;
        locationId: number;
        quantity: string;
        refundRate: string;
        inventoryCost: string;
      }>;
    }) => {
      const response = await apiRequest("POST", "/api/credit-notes", data);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Success",
        description: data.message || "Credit/Debit note created successfully",
      });
      form.reset({
        noteType: "Credit Note",
        voucherDate: format(new Date(), "yyyy-MM-dd"),
        cashAccountType: "",
        cashAccountId: 0,
        cashAccountName: "",
        description: "",
      });
      setItems([]);
      setSearchTerm("");
      setSelectedItem(null);
      setSelectedLocationId(0);
      setItemQuantity("");
      setRefundRate("");
      setInventoryCost("");
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/location-summary"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create credit/debit note",
        variant: "destructive",
      });
    },
  });

  const handleSelectItem = (item: StockItemData) => {
    setSelectedItem(item);
    setSearchTerm(item.name);
    setItemQuantity("1");
    if (selectedLocationId > 0) {
      const locData = item.locationData[selectedLocationId];
      if (locData) {
        setInventoryCost(locData.rate.toFixed(2));
      }
    }
  };

  const addItem = () => {
    if (!selectedItem) {
      toast({
        title: "No item selected",
        description: "Please search and select a stock item",
        variant: "destructive",
      });
      return;
    }

    if (!selectedLocationId) {
      toast({
        title: "No location selected",
        description: "Please select a location",
        variant: "destructive",
      });
      return;
    }

    const qty = parseFloat(itemQuantity);
    const refund = parseFloat(refundRate);
    const cost = parseFloat(inventoryCost);

    if (isNaN(qty) || qty <= 0) {
      toast({
        title: "Invalid quantity",
        description: "Please enter a valid quantity greater than 0",
        variant: "destructive",
      });
      return;
    }

    if (isNaN(refund) || refund < 0) {
      toast({
        title: "Invalid refund rate",
        description: "Please enter a valid refund rate",
        variant: "destructive",
      });
      return;
    }

    const location = locations.find((l) => l.id === selectedLocationId);
    if (!location) return;

    setItems((prev) => [
      ...prev,
      {
        stockItemId: selectedItem.id,
        stockItemName: selectedItem.name,
        locationId: selectedLocationId,
        locationName: location.name,
        quantity: qty.toString(),
        refundRate: refund.toFixed(2),
        inventoryCost: (cost || 0).toFixed(2),
        uom: selectedItem.uom,
      },
    ]);

    setSelectedItem(null);
    setSearchTerm("");
    setItemQuantity("");
    setRefundRate("");
    setInventoryCost("");
    searchInputRef.current?.focus();
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const totalRefund = items.reduce((sum, item) => {
    return sum + parseFloat(item.quantity) * parseFloat(item.refundRate);
  }, 0);

  const totalInventoryValue = items.reduce((sum, item) => {
    return sum + parseFloat(item.quantity) * parseFloat(item.inventoryCost);
  }, 0);

  const onSubmit = (values: CreditNoteFormData) => {
    if (items.length === 0) {
      toast({
        title: "No items",
        description: "Please add at least one item",
        variant: "destructive",
      });
      return;
    }

    createCreditNoteMutation.mutate({
      noteType: values.noteType,
      voucherDate: values.voucherDate,
      cashAccountId: values.cashAccountId,
      cashAccountType: values.cashAccountType,
      description: values.description || "",
      items: items.map((item) => ({
        stockItemId: item.stockItemId,
        locationId: item.locationId,
        quantity: item.quantity,
        refundRate: item.refundRate,
        inventoryCost: item.inventoryCost,
      })),
    });
  };

  const noteType = form.watch("noteType");
  const cashAccountId = form.watch("cashAccountId");
  const cashAccountType = form.watch("cashAccountType");
  const cashAccountName = form.watch("cashAccountName");

  const getStockAtLocation = (item: StockItemData, locId: number) => {
    return item.locationData[locId]?.quantity || 0;
  };

  return (
    <div className="flex gap-4">
      <Card className="flex-[2]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {noteType === "Credit Note" ? "Credit Note (Customer Return)" : "Debit Note"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-4 gap-4">
                <FormField
                  control={form.control}
                  name="noteType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-note-type">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Credit Note">Credit Note</SelectItem>
                          <SelectItem value="Debit Note">Debit Note</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="voucherDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full justify-start text-left font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                              data-testid="button-credit-note-date"
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {field.value ? formatDisplayDate(field.value) : "Pick date"}
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value ? new Date(field.value) : undefined}
                            onSelect={(date) => {
                              if (date) field.onChange(format(date, "yyyy-MM-dd"));
                            }}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="cashAccountId"
                  render={() => (
                    <FormItem className="col-span-2">
                      <FormLabel>
                        {noteType === "Credit Note" ? "Refund From (Cash/Bank)" : "Receive Into"}
                      </FormLabel>
                      <FormControl>
                        <AccountAutocomplete
                          value={
                            cashAccountId > 0
                              ? { type: cashAccountType, id: cashAccountId, name: cashAccountName || "" }
                              : null
                          }
                          onChange={(type, id, name) => {
                            form.setValue("cashAccountType", type);
                            form.setValue("cashAccountId", id);
                            form.setValue("cashAccountName", name);
                          }}
                          allAccounts={allAccounts}
                          rowIndex={-1}
                          placeholder="Select cash/bank account..."
                          testId="input-credit-note-account"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
                <div className="flex items-center gap-2 mb-2">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">Add Return Items</span>
                </div>

                <div className="grid grid-cols-6 gap-3">
                  <div className="col-span-2 relative">
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                      Search Item
                    </label>
                    <Input
                      ref={searchInputRef}
                      value={searchTerm}
                      onChange={(e) => {
                        setSearchTerm(e.target.value);
                        setSelectedItem(null);
                      }}
                      placeholder="Type item name or code..."
                      data-testid="input-search-item"
                    />
                    {searchTerm.length > 0 && !selectedItem && filteredItems.length > 0 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-auto">
                        {filteredItems.slice(0, 10).map((item) => {
                          const totalStock = Object.values(item.locationData).reduce(
                            (sum, loc) => sum + loc.quantity,
                            0
                          );
                          return (
                            <div
                              key={item.id}
                              className="px-3 py-2 hover:bg-accent cursor-pointer flex justify-between items-center"
                              onClick={() => handleSelectItem(item)}
                              data-testid={`search-result-${item.id}`}
                            >
                              <div>
                                <p className="font-medium">{item.name}</p>
                                <p className="text-xs text-muted-foreground">{item.code}</p>
                              </div>
                              <Badge variant={totalStock > 0 ? "default" : "secondary"}>
                                {formatNumber(totalStock, 0)} {item.uom}
                              </Badge>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                      Location
                    </label>
                    <Select
                      value={selectedLocationId?.toString() || ""}
                      onValueChange={(v) => setSelectedLocationId(parseInt(v))}
                    >
                      <SelectTrigger data-testid="select-location">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {locations.map((loc) => (
                          <SelectItem key={loc.id} value={loc.id.toString()}>
                            {loc.name}
                            {selectedItem && (
                              <span className="ml-2 text-muted-foreground">
                                ({formatNumber(getStockAtLocation(selectedItem, loc.id), 0)})
                              </span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                      Qty
                    </label>
                    <Input
                      type="number"
                      step="1"
                      value={itemQuantity}
                      onChange={(e) => setItemQuantity(e.target.value)}
                      placeholder="0"
                      data-testid="input-item-quantity"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                      Refund Rate
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      value={refundRate}
                      onChange={(e) => setRefundRate(e.target.value)}
                      placeholder="0.00"
                      data-testid="input-refund-rate"
                    />
                  </div>

                  <div className="flex items-end">
                    <Button
                      type="button"
                      onClick={addItem}
                      disabled={!selectedItem}
                      className="w-full"
                      data-testid="button-add-item"
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add
                    </Button>
                  </div>
                </div>

                {selectedItem && selectedLocationId > 0 && (
                  <div className="flex gap-4 text-sm bg-background p-2 rounded border">
                    <span>
                      <span className="text-muted-foreground">Stock at location:</span>{" "}
                      <span className="font-mono font-medium">
                        {formatNumber(getStockAtLocation(selectedItem, selectedLocationId), 0)}{" "}
                        {selectedItem.uom}
                      </span>
                    </span>
                    <span>
                      <span className="text-muted-foreground">Inventory Cost:</span>{" "}
                      <span className="font-mono font-medium">{formatNumber(parseFloat(inventoryCost) || 0)}</span>
                    </span>
                  </div>
                )}
              </div>

              {items.length > 0 && (
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead>Location</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Refund Rate</TableHead>
                          <TableHead className="text-right">Refund Amt</TableHead>
                          <TableHead className="text-right">Inv. Cost</TableHead>
                          <TableHead className="text-right">Inv. Value</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((item, index) => {
                          const qty = parseFloat(item.quantity);
                          const refundAmt = qty * parseFloat(item.refundRate);
                          const invValue = qty * parseFloat(item.inventoryCost);
                          return (
                            <TableRow key={index} data-testid={`credit-note-item-${index}`}>
                              <TableCell className="font-medium">{item.stockItemName}</TableCell>
                              <TableCell>{item.locationName}</TableCell>
                              <TableCell className="text-right font-mono">
                                {formatNumber(qty, 0)} {item.uom}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatNumber(parseFloat(item.refundRate))}
                              </TableCell>
                              <TableCell className="text-right font-mono text-primary">
                                {formatNumber(refundAmt)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-muted-foreground">
                                {formatNumber(parseFloat(item.inventoryCost))}
                              </TableCell>
                              <TableCell className="text-right font-mono text-muted-foreground">
                                {formatNumber(invValue)}
                              </TableCell>
                              <TableCell>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removeItem(index)}
                                  data-testid={`button-remove-item-${index}`}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Enter notes..."
                        className="resize-none"
                        rows={2}
                        data-testid="input-credit-note-description"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="flex justify-between items-center pt-4 border-t">
                <div className="space-y-1">
                  <div className="text-lg font-semibold">
                    Refund Total: <span className="font-mono text-primary">{formatNumber(totalRefund)}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Inventory Value: <span className="font-mono">{formatNumber(totalInventoryValue)}</span>
                    {Math.abs(totalRefund - totalInventoryValue) > 0.01 && (
                      <span className="ml-2">
                        (Variance: {formatNumber(totalRefund - totalInventoryValue)})
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  type="submit"
                  size="lg"
                  disabled={items.length === 0 || createCreditNoteMutation.isPending}
                  data-testid="button-create-credit-note"
                >
                  {createCreditNoteMutation.isPending
                    ? "Creating..."
                    : noteType === "Credit Note"
                    ? "Create Credit Note"
                    : "Create Debit Note"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
