import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { formatNumber } from "@/lib/formatNumber";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { CalendarIcon, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AccountAutocomplete } from "@/components/AccountAutocomplete";
import type { CombinedAccount } from "@/components/AccountAutocomplete";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

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

interface CreditNoteItem {
  stockItemId: number;
  stockItemName: string;
  locationId: number;
  locationName: string;
  quantity: string;
  rate: string;
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
  const [selectedStockItemId, setSelectedStockItemId] = useState<number>(0);
  const [selectedLocationId, setSelectedLocationId] = useState<number>(0);
  const [itemQuantity, setItemQuantity] = useState("");
  const [itemRate, setItemRate] = useState("");

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

  const { data: stockItems = [] } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items"],
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const createCreditNoteMutation = useMutation({
    mutationFn: async (data: {
      noteType: string;
      voucherDate: string;
      cashAccountId: number;
      cashAccountType: string;
      description: string;
      items: Array<{ stockItemId: number; locationId: number; quantity: string; rate: string }>;
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

  const addItem = () => {
    if (!selectedStockItemId || !selectedLocationId) {
      toast({
        title: "Missing fields",
        description: "Please select a stock item and location",
        variant: "destructive",
      });
      return;
    }

    const qty = parseFloat(itemQuantity);
    const rate = parseFloat(itemRate);

    if (isNaN(qty) || qty <= 0) {
      toast({
        title: "Invalid quantity",
        description: "Please enter a valid quantity greater than 0",
        variant: "destructive",
      });
      return;
    }

    if (isNaN(rate) || rate < 0) {
      toast({
        title: "Invalid rate",
        description: "Please enter a valid rate",
        variant: "destructive",
      });
      return;
    }

    const stockItem = stockItems.find((s) => s.id === selectedStockItemId);
    const location = locations.find((l) => l.id === selectedLocationId);

    if (!stockItem || !location) return;

    setItems((prev) => [
      ...prev,
      {
        stockItemId: selectedStockItemId,
        stockItemName: stockItem.name,
        locationId: selectedLocationId,
        locationName: location.name,
        quantity: qty.toString(),
        rate: rate.toFixed(2),
        uom: stockItem.uom,
      },
    ]);

    setSelectedStockItemId(0);
    setItemQuantity("");
    setItemRate("");
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const totalAmount = items.reduce((sum, item) => {
    return sum + parseFloat(item.quantity) * parseFloat(item.rate);
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
        rate: item.rate,
      })),
    });
  };

  const noteType = form.watch("noteType");
  const cashAccountId = form.watch("cashAccountId");
  const cashAccountType = form.watch("cashAccountType");
  const cashAccountName = form.watch("cashAccountName");

  return (
    <div className="flex gap-4">
      <Card className="flex-1">
        <CardHeader>
          <CardTitle>Credit / Debit Note</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="noteType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Note Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-note-type">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Credit Note">Credit Note (Refund)</SelectItem>
                          <SelectItem value="Debit Note">Debit Note</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
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
                              {field.value ? formatDisplayDate(field.value) : "Pick a date"}
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value ? new Date(field.value) : undefined}
                            onSelect={(date) => {
                              if (date) {
                                field.onChange(format(date, "yyyy-MM-dd"));
                              }
                            }}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="cashAccountId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {noteType === "Credit Note" ? "Refund From (Cash/Bank)" : "Receive Into"}
                      </FormLabel>
                      <FormControl>
                        <AccountAutocomplete
                          value={
                            cashAccountId > 0
                              ? {
                                  type: cashAccountType,
                                  id: cashAccountId,
                                  name: cashAccountName || "",
                                }
                              : null
                          }
                          onChange={(type, id, name) => {
                            form.setValue("cashAccountType", type);
                            form.setValue("cashAccountId", id);
                            form.setValue("cashAccountName", name);
                          }}
                          allAccounts={allAccounts}
                          rowIndex={-1}
                          placeholder={noteType === "Credit Note" ? "Select cash/bank account..." : "Select account..."}
                          testId="input-credit-note-account"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description / Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Enter description..."
                        className="resize-none"
                        rows={2}
                        data-testid="input-credit-note-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-base">Add Items</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-5 gap-3 items-end">
                    <div>
                      <label className="text-sm font-medium">Stock Item</label>
                      <Select
                        value={selectedStockItemId?.toString() || ""}
                        onValueChange={(v) => setSelectedStockItemId(parseInt(v))}
                      >
                        <SelectTrigger data-testid="select-stock-item">
                          <SelectValue placeholder="Select item" />
                        </SelectTrigger>
                        <SelectContent>
                          {stockItems.map((item) => (
                            <SelectItem key={item.id} value={item.id.toString()}>
                              {item.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label className="text-sm font-medium">Location</label>
                      <Select
                        value={selectedLocationId?.toString() || ""}
                        onValueChange={(v) => setSelectedLocationId(parseInt(v))}
                      >
                        <SelectTrigger data-testid="select-location">
                          <SelectValue placeholder="Select location" />
                        </SelectTrigger>
                        <SelectContent>
                          {locations.map((loc) => (
                            <SelectItem key={loc.id} value={loc.id.toString()}>
                              {loc.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label className="text-sm font-medium">Quantity</label>
                      <Input
                        type="number"
                        step="0.001"
                        value={itemQuantity}
                        onChange={(e) => setItemQuantity(e.target.value)}
                        placeholder="0"
                        data-testid="input-item-quantity"
                      />
                    </div>

                    <div>
                      <label className="text-sm font-medium">Rate</label>
                      <Input
                        type="number"
                        step="0.01"
                        value={itemRate}
                        onChange={(e) => setItemRate(e.target.value)}
                        placeholder="0.00"
                        data-testid="input-item-rate"
                      />
                    </div>

                    <Button type="button" onClick={addItem} data-testid="button-add-item">
                      <Plus className="h-4 w-4 mr-1" />
                      Add
                    </Button>
                  </div>

                  {items.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead>Location</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Rate</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((item, index) => (
                          <TableRow key={index} data-testid={`credit-note-item-${index}`}>
                            <TableCell>{item.stockItemName}</TableCell>
                            <TableCell>{item.locationName}</TableCell>
                            <TableCell className="text-right font-mono">
                              {formatNumber(parseFloat(item.quantity), 0)} {item.uom}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatNumber(parseFloat(item.rate))}
                            </TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              {formatNumber(parseFloat(item.quantity) * parseFloat(item.rate))}
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
                        ))}
                        <TableRow className="bg-muted/50">
                          <TableCell colSpan={4} className="font-medium text-right">
                            Total
                          </TableCell>
                          <TableCell className="text-right font-mono font-bold">
                            {formatNumber(totalAmount)}
                          </TableCell>
                          <TableCell></TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <div className="flex justify-between items-center pt-4 border-t">
                <div className="text-lg font-semibold">
                  Total: <span className="font-mono">{formatNumber(totalAmount)}</span>
                </div>
                <Button
                  type="submit"
                  disabled={items.length === 0 || createCreditNoteMutation.isPending}
                  data-testid="button-create-credit-note"
                >
                  {createCreditNoteMutation.isPending
                    ? "Creating..."
                    : noteType === "Credit Note"
                    ? "Create Credit Note & Add to Stock"
                    : "Create Debit Note & Remove from Stock"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
