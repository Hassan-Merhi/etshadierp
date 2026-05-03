import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CalendarIcon, Plus, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { formatNumber } from "@/lib/formatNumber";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import type { Voucher } from "@shared/schema";

// Types
interface VoucherEditDialogProps {
  voucherId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface LedgerAccount {
  id: number;
  code: string;
  name: string;
  accountType: string;
}

interface BankAccount {
  id: number;
  accountNumber: string;
  bankName: string;
}

interface Supplier {
  id: number;
  code: string;
  name: string;
  legalName: string;
}

interface Employee {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
}

interface FixedAsset {
  id: number;
  assetCode: string;
  assetName: string;
}

interface VoucherEntry {
  ledgerAccountId: number | null;
  bankAccountId: number | null;
  fixedAssetId: number | null;
  supplierId: number | null;
  employeeId: number | null;
  debitAmount: string;
  creditAmount: string;
  narration: string;
}

const voucherEntrySchema = z.object({
  ledgerAccountId: z.number().nullable(),
  bankAccountId: z.number().nullable(),
  fixedAssetId: z.number().nullable(),
  supplierId: z.number().nullable(),
  employeeId: z.number().nullable(),
  debitAmount: z.string(),
  creditAmount: z.string(),
  narration: z.string(),
});

const voucherSchema = z.object({
  voucherNumber: z.string().min(1, "Voucher number is required"),
  voucherType: z.string().min(1, "Voucher type is required"),
  voucherDate: z.date(),
  description: z.string(),
  optional: z.boolean(),
  entries: z.array(voucherEntrySchema).min(1, "At least one entry is required"),
});

type VoucherFormData = z.infer<typeof voucherSchema>;

export function VoucherEditDialog({ voucherId, open, onOpenChange }: VoucherEditDialogProps) {
  const { toast } = useToast();
  const { formatAmount } = useCurrencyContext();
  const { formatDisplayDate } = useDateFormat();
  const [showOptionalWarning, setShowOptionalWarning] = useState(false);

  // Fetch reference data
  const { data: ledgerAccounts = [] } = useQuery<LedgerAccount[]>({ 
    queryKey: ["/api/ledger-accounts"],
    enabled: open,
  });
  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({ 
    queryKey: ["/api/bank-accounts"],
    enabled: open,
  });
  const { data: suppliers = [] } = useQuery<Supplier[]>({ 
    queryKey: ["/api/suppliers"],
    enabled: open,
  });
  const { data: employees = [] } = useQuery<Employee[]>({ 
    queryKey: ["/api/employees"],
    enabled: open,
  });
  const { data: fixedAssets = [] } = useQuery<FixedAsset[]>({ 
    queryKey: ["/api/fixed-assets"],
    enabled: open,
  });

  // Fetch voucher data
  const { data: voucherData, isLoading } = useQuery<Voucher & { entries?: VoucherEntry[] }>({
    queryKey: ["/api/vouchers", voucherId],
    enabled: open && !!voucherId,
  });

  const form = useForm<VoucherFormData>({
    resolver: zodResolver(voucherSchema),
    defaultValues: {
      voucherNumber: "",
      voucherType: "Journal",
      voucherDate: new Date(),
      description: "",
      optional: false,
      entries: [
        {
          ledgerAccountId: null,
          bankAccountId: null,
          fixedAssetId: null,
          supplierId: null,
          employeeId: null,
          debitAmount: "0",
          creditAmount: "0",
          narration: "",
        },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "entries",
  });

  // Load voucher data into form
  useEffect(() => {
    if (voucherData && open) {
      const voucherDate = new Date(voucherData.voucherDate);
      
      form.reset({
        voucherNumber: voucherData.voucherNumber || "",
        voucherType: voucherData.voucherType || "Journal",
        voucherDate: voucherDate,
        description: voucherData.description || "",
        optional: voucherData.optional || false,
        entries: voucherData.entries && voucherData.entries.length > 0
          ? voucherData.entries.map((entry: any) => ({
              ledgerAccountId: entry.ledgerAccountId || null,
              bankAccountId: entry.bankAccountId || null,
              fixedAssetId: entry.fixedAssetId || null,
              supplierId: entry.supplierId || null,
              employeeId: entry.employeeId || null,
              debitAmount: entry.debitAmount || "0",
              creditAmount: entry.creditAmount || "0",
              narration: entry.narration || "",
            }))
          : [
              {
                ledgerAccountId: null,
                bankAccountId: null,
                fixedAssetId: null,
                supplierId: null,
                employeeId: null,
                debitAmount: "0",
                creditAmount: "0",
                narration: "",
              },
            ],
      });
    }
  }, [voucherData, open, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: VoucherFormData) => {
      if (!voucherId) throw new Error("Voucher ID is required");

      const voucherPayload = {
        voucherType: data.voucherType,
        voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
        description: data.description,
        optional: data.optional,
      };

      const entriesPayload = data.entries.map(entry => ({
        ledgerAccountId: entry.ledgerAccountId,
        bankAccountId: entry.bankAccountId,
        fixedAssetId: entry.fixedAssetId,
        supplierId: entry.supplierId,
        employeeId: entry.employeeId,
        debitAmount: entry.debitAmount,
        creditAmount: entry.creditAmount,
        narration: entry.narration,
      }));

      return await apiRequest("PUT", `/api/vouchers/${voucherId}/with-entries`, {
        voucher: voucherPayload,
        entries: entriesPayload,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Voucher updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      onOpenChange(false);
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

  const onSubmit = (data: VoucherFormData) => {
    // Calculate totals
    const totalDebits = data.entries.reduce((sum, entry) => sum + parseFloat(entry.debitAmount || "0"), 0);
    const totalCredits = data.entries.reduce((sum, entry) => sum + parseFloat(entry.creditAmount || "0"), 0);

    // Show warning for optional vouchers with mismatched debits/credits
    if (data.optional && Math.abs(totalDebits - totalCredits) >= 0.01) {
      setShowOptionalWarning(true);
    } else {
      setShowOptionalWarning(false);
    }

    updateMutation.mutate(data);
  };

  // Calculate totals
  const entries = form.watch("entries");
  const totalDebits = entries.reduce((sum, entry) => sum + parseFloat(entry.debitAmount || "0"), 0);
  const totalCredits = entries.reduce((sum, entry) => sum + parseFloat(entry.creditAmount || "0"), 0);
  const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01;
  const isOptional = form.watch("optional");

  const getAccountName = (entry: VoucherEntry) => {
    if (entry.ledgerAccountId) {
      const account = ledgerAccounts.find(a => a.id === entry.ledgerAccountId);
      return account ? account.name : "";
    }
    if (entry.bankAccountId) {
      const account = bankAccounts.find(a => a.id === entry.bankAccountId);
      return account ? account.bankName : "";
    }
    if (entry.supplierId) {
      const supplier = suppliers.find(s => s.id === entry.supplierId);
      return supplier ? supplier.legalName : "";
    }
    if (entry.employeeId) {
      const employee = employees.find(e => e.id === entry.employeeId);
      return employee ? `${employee.firstName} ${employee.lastName}` : "";
    }
    if (entry.fixedAssetId) {
      const asset = fixedAssets.find(a => a.id === entry.fixedAssetId);
      return asset ? asset.assetName : "";
    }
    return "";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Voucher</DialogTitle>
          <DialogDescription>
            Modify voucher details and entries. {!isOptional && "Debits must equal credits for active vouchers."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="text-center py-8">Loading voucher data...</div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
              {/* Voucher Header */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="voucherNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Voucher Number</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-voucher-number" disabled />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="voucherType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger data-testid="select-voucher-type">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Payment">Payment</SelectItem>
                          <SelectItem value="Receipt">Receipt</SelectItem>
                          <SelectItem value="Journal">Journal</SelectItem>
                          <SelectItem value="Sales">Sales</SelectItem>
                          <SelectItem value="Purchase">Purchase</SelectItem>
                          <SelectItem value="Contra">Contra</SelectItem>
                          <SelectItem value="Stock Transfer">Stock Transfer</SelectItem>
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
                                "w-full pl-3 text-left font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                              data-testid="button-select-date"
                            >
                              {field.value ? formatDisplayDate(field.value) : "Pick a date"}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value}
                            onSelect={field.onChange}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
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
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea {...field} data-testid="input-description" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="optional"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-edit-optional"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="font-medium">
                        Mark as Optional (non-posting)
                      </FormLabel>
                    </div>
                  </FormItem>
                )}
              />

              {/* Voucher Entries */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium">Voucher Entries</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      append({
                        ledgerAccountId: null,
                        bankAccountId: null,
                        fixedAssetId: null,
                        supplierId: null,
                        employeeId: null,
                        debitAmount: "0",
                        creditAmount: "0",
                        narration: "",
                      })
                    }
                    data-testid="button-add-entry"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Entry
                  </Button>
                </div>

                <div className="table-responsive">
                  <table className="w-full text-sm">
                    <thead className="border-b sticky top-0 z-30">
                      <tr>
                        {(form.watch("voucherType") === "Consumption" || form.watch("voucherType") === "Production") ? (
                          <>
                            <th className="text-left py-2 px-2 w-[40%]">Item Name</th>
                            <th className="text-right py-2 px-2 w-[15%]">Qty</th>
                            <th className="text-right py-2 px-2 w-[15%]">Amount</th>
                            <th className="text-right py-2 px-2 w-[20%]">Total Amount</th>
                          </>
                        ) : (
                          <>
                            <th className="text-left py-2 px-2 w-[60%]">Account</th>
                            {(form.watch("voucherType") === "Payment" || form.watch("voucherType") === "Receipt") ? (
                              <th className="text-right py-2 px-2 w-[35%]">Amount</th>
                            ) : (
                              <>
                                <th className="text-right py-2 px-2 w-[15%]">Debit</th>
                                <th className="text-right py-2 px-2 w-[15%]">Credit</th>
                                <th className="text-left py-2 px-2 w-[20%]">Narration</th>
                              </>
                            )}
                          </>
                        )}
                        <th className="text-center py-2 px-2 w-[5%]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((field, index) => {
                        // For Payment/Receipt, hide cash source entries and zero-amount entries
                        const voucherType = form.watch("voucherType");
                        const debitAmount = parseFloat(form.watch(`entries.${index}.debitAmount`) || "0");
                        const creditAmount = parseFloat(form.watch(`entries.${index}.creditAmount`) || "0");
                        
                        if (voucherType === "Payment" || voucherType === "Receipt") {
                          // Hide entries where both amounts are 0 (empty/removed entries)
                          if (debitAmount === 0 && creditAmount === 0) {
                            return null;
                          }
                          // Hide cash source entries for Payment (credit entries with no debit)
                          if (voucherType === "Payment" && creditAmount > 0 && debitAmount === 0) {
                            return null;
                          }
                          // Hide cash source entries for Receipt (debit entries with no credit)
                          if (voucherType === "Receipt" && debitAmount > 0 && creditAmount === 0) {
                            return null;
                          }
                        }
                        
                        const isConsumptionOrProduction = voucherType === "Consumption" || voucherType === "Production";
                        
                        // For Consumption/Production, parse narration to extract item name, qty, and rate
                        let itemName = "", qty = 0, rate = 0;
                        if (isConsumptionOrProduction) {
                          const narration = form.watch(`entries.${index}.narration`) || "";
                          // Parse pattern: "Consumption of -1.000 x ITEM NAME @ $98.62"
                          const match = narration.match(/of\s+([-\d.]+)\s+x\s+(.+?)\s+@\s+\$?([\d.]+)/);
                          if (match) {
                            qty = Math.abs(parseFloat(match[1]));
                            itemName = match[2];
                            rate = parseFloat(match[3]);
                          }
                        }
                        
                        return (
                        <tr key={field.id} className="border-b">
                          {isConsumptionOrProduction ? (
                            <>
                              <td className="py-2 px-2">{itemName || "-"}</td>
                              <td className="py-2 px-2 text-right font-mono">{qty.toFixed(3)}</td>
                              <td className="py-2 px-2 text-right font-mono">{formatAmount(rate)}</td>
                              <td className="py-2 px-2 text-right font-mono">{formatAmount(qty * rate)}</td>
                            </>
                          ) : (
                            <>
                              <td className="py-2 px-2">
                                <div className="space-y-1">
                                  <Select
                                    value={
                                      form.watch(`entries.${index}.ledgerAccountId`)?.toString() ||
                                      form.watch(`entries.${index}.bankAccountId`)?.toString() ||
                                      form.watch(`entries.${index}.supplierId`)?.toString() ||
                                      form.watch(`entries.${index}.employeeId`)?.toString() ||
                                      form.watch(`entries.${index}.fixedAssetId`)?.toString() ||
                                      ""
                                    }
                                    onValueChange={(value) => {
                                      const [type, id] = value.split("-");
                                      form.setValue(`entries.${index}.ledgerAccountId`, null);
                                      form.setValue(`entries.${index}.bankAccountId`, null);
                                      form.setValue(`entries.${index}.supplierId`, null);
                                      form.setValue(`entries.${index}.employeeId`, null);
                                      form.setValue(`entries.${index}.fixedAssetId`, null);

                                      if (type === "ledger") form.setValue(`entries.${index}.ledgerAccountId`, parseInt(id));
                                      if (type === "bank") form.setValue(`entries.${index}.bankAccountId`, parseInt(id));
                                      if (type === "supplier") form.setValue(`entries.${index}.supplierId`, parseInt(id));
                                      if (type === "employee") form.setValue(`entries.${index}.employeeId`, parseInt(id));
                                      if (type === "asset") form.setValue(`entries.${index}.fixedAssetId`, parseInt(id));
                                    }}
                                  >
                                    <SelectTrigger data-testid={`select-account-${index}`}>
                                      <SelectValue placeholder="Select account" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <div className="text-xs font-semibold px-2 py-1 text-muted-foreground">Ledger Accounts</div>
                                      {ledgerAccounts.map((acc) => (
                                        <SelectItem key={`ledger-${acc.id}`} value={`ledger-${acc.id}`}>
                                          {acc.code} - {acc.name}
                                        </SelectItem>
                                      ))}
                                      <div className="text-xs font-semibold px-2 py-1 text-muted-foreground mt-2">Bank Accounts</div>
                                      {bankAccounts.map((acc) => (
                                        <SelectItem key={`bank-${acc.id}`} value={`bank-${acc.id}`}>
                                          {acc.accountNumber} - {acc.bankName}
                                        </SelectItem>
                                      ))}
                                      <div className="text-xs font-semibold px-2 py-1 text-muted-foreground mt-2">Suppliers</div>
                                      {suppliers.map((sup) => (
                                        <SelectItem key={`supplier-${sup.id}`} value={`supplier-${sup.id}`}>
                                          {sup.code} - {sup.name}
                                        </SelectItem>
                                      ))}
                                      <div className="text-xs font-semibold px-2 py-1 text-muted-foreground mt-2">Employees</div>
                                      {employees.map((emp) => (
                                        <SelectItem key={`employee-${emp.id}`} value={`employee-${emp.id}`}>
                                          {emp.code} - {emp.firstName} {emp.lastName}
                                        </SelectItem>
                                      ))}
                                      <div className="text-xs font-semibold px-2 py-1 text-muted-foreground mt-2">Fixed Assets</div>
                                      {fixedAssets.map((asset) => (
                                        <SelectItem key={`asset-${asset.id}`} value={`asset-${asset.id}`}>
                                          {asset.assetCode} - {asset.assetName}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </td>
                              {(form.watch("voucherType") === "Payment" || form.watch("voucherType") === "Receipt") ? (
                                <td className="py-2 px-2">
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={
                                      parseFloat(form.watch(`entries.${index}.debitAmount`) || "0") > 0
                                        ? form.watch(`entries.${index}.debitAmount`)
                                        : form.watch(`entries.${index}.creditAmount`) || ""
                                    }
                                    onChange={(e) => {
                                      const voucherType = form.watch("voucherType");
                                      if (voucherType === "Payment") {
                                        form.setValue(`entries.${index}.debitAmount`, e.target.value);
                                        form.setValue(`entries.${index}.creditAmount`, "0");
                                      } else {
                                        form.setValue(`entries.${index}.creditAmount`, e.target.value);
                                        form.setValue(`entries.${index}.debitAmount`, "0");
                                      }
                                    }}
                                    className="text-right"
                                    data-testid={`input-amount-${index}`}
                                  />
                                </td>
                              ) : (
                                <>
                                  <td className="py-2 px-2">
                                    <Input
                                      type="number"
                                      step="0.01"
                                      {...form.register(`entries.${index}.debitAmount`)}
                                      className="text-right"
                                      data-testid={`input-debit-${index}`}
                                      onKeyDown={(e) => {
                                        if (e.key === "Tab") {
                                          e.preventDefault();
                                          const creditInput = document.querySelector(`[data-testid="input-credit-${index}"]`) as HTMLInputElement;
                                          if (creditInput) creditInput.focus();
                                        }
                                      }}
                                    />
                                  </td>
                                  <td className="py-2 px-2">
                                    <Input
                                      type="number"
                                      step="0.01"
                                      {...form.register(`entries.${index}.creditAmount`)}
                                      className="text-right"
                                      data-testid={`input-credit-${index}`}
                                      onKeyDown={(e) => {
                                        if (e.key === "Tab") {
                                          e.preventDefault();
                                          const narrationInput = document.querySelector(`[data-testid="input-narration-${index}"]`) as HTMLInputElement;
                                          if (narrationInput) narrationInput.focus();
                                        }
                                      }}
                                    />
                                  </td>
                                  <td className="py-2 px-2">
                                    <Input
                                      {...form.register(`entries.${index}.narration`)}
                                      data-testid={`input-narration-${index}`}
                                    />
                                  </td>
                                </>
                              )}
                            </>
                          )}
                          <td className="py-2 px-2 text-center">
                            {fields.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => remove(index)}
                                data-testid={`button-remove-entry-${index}`}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="border-t-2 font-semibold">
                      <tr>
                        {(form.watch("voucherType") === "Consumption" || form.watch("voucherType") === "Production") ? (
                          <>
                            <td className="py-2 px-2 text-right">Total:</td>
                            <td className="py-2 px-2 text-right font-mono">
                              {fields.reduce((sum, _, index) => {
                                const narration = form.watch(`entries.${index}.narration`) || "";
                                const match = narration.match(/of\s+([-\d.]+)\s+x/);
                                return sum + (match ? Math.abs(parseFloat(match[1])) : 0);
                              }, 0).toFixed(3)}
                            </td>
                            <td className="py-2 px-2"></td>
                            <td className="py-2 px-2 text-right font-mono">
                              {formatAmount(fields.reduce((sum, _, index) => {
                                const narration = form.watch(`entries.${index}.narration`) || "";
                                const match = narration.match(/of\s+([-\d.]+)\s+x\s+.+?\s+@\s+\$?([\d.]+)/);
                                if (match) {
                                  const qty = Math.abs(parseFloat(match[1]));
                                  const rate = parseFloat(match[2]);
                                  return sum + (qty * rate);
                                }
                                return sum;
                              }, 0))}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="py-2 px-2 text-right">Total:</td>
                            {(form.watch("voucherType") === "Payment" || form.watch("voucherType") === "Receipt") ? (
                              <>
                                <td className="py-2 px-2 text-right font-mono" data-testid="text-total-amount">
                                  {formatAmount(Math.max(totalDebits, totalCredits))}
                                </td>
                                <td className="py-2 px-2"></td>
                              </>
                            ) : (
                              <>
                                <td className="py-2 px-2 text-right font-mono" data-testid="text-total-debits">
                                  {formatAmount(totalDebits)}
                                </td>
                                <td className="py-2 px-2 text-right font-mono" data-testid="text-total-credits">
                                  {formatAmount(totalCredits)}
                                </td>
                                <td colSpan={2} className="py-2 px-2">
                                  {!isBalanced && !isOptional && (
                                    <div className="flex items-center gap-2 text-destructive text-sm">
                                      <AlertTriangle className="h-4 w-4" />
                                      Debits must equal credits
                                    </div>
                                  )}
                                  {!isBalanced && isOptional && showOptionalWarning && (
                                    <div className="flex items-center gap-2 text-amber-500 text-sm">
                                      <AlertTriangle className="h-4 w-4" />
                                      Optional – not posted to ledgers
                                    </div>
                                  )}
                                  {isBalanced && (
                                    <div className="text-sm text-muted-foreground">Balanced</div>
                                  )}
                                </td>
                              </>
                            )}
                          </>
                        )}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateMutation.isPending || (!isBalanced && !isOptional)}
                  data-testid="button-save"
                >
                  {updateMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
