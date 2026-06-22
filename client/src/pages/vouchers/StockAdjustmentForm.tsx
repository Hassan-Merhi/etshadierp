import { UseFormReturn, useFieldArray } from "react-hook-form";
import { format } from "date-fns";
import { X, Plus, FileDown, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface StockAdjustmentFormProps {
  stockAdjustmentForm: UseFormReturn<any>;
  onSubmit: (data: any) => void;
  locations: any[];
  stockItems: any[];
  consumptionTotal: number;
  productionTotal: number;
  currentAdjustmentType: string;
  displayAdjustmentTotal: number;
  voucherIdToEdit: number | null;
  stockAdjustmentToEdit: any;
  handleExportVoucher: (detailed: boolean) => void;
  stockAdjustmentMutation: any;
  activeAdjustmentRow: number | null;
  setActiveAdjustmentRow: (idx: number | null) => void;
  adjustmentSearchTerm: string;
  setAdjustmentSearchTerm: (term: string) => void;
  setAdjustmentHighlightedIndex: (idx: number) => void;
  filteredAdjustmentItems: any[];
  adjustmentItemsWithInventory: any[];
  setShowAdjustmentSidebar: (show: boolean) => void;
  formatAmount: (amount: number) => string;
  formatNumber: (num: any, decimals?: number) => string;
}

export function StockAdjustmentForm({
  stockAdjustmentForm,
  onSubmit,
  locations,
  stockItems,
  consumptionTotal,
  productionTotal,
  currentAdjustmentType,
  displayAdjustmentTotal,
  voucherIdToEdit,
  stockAdjustmentToEdit,
  handleExportVoucher,
  stockAdjustmentMutation,
  activeAdjustmentRow,
  setActiveAdjustmentRow,
  adjustmentSearchTerm,
  setAdjustmentSearchTerm,
  setAdjustmentHighlightedIndex,
  filteredAdjustmentItems,
  adjustmentItemsWithInventory,
  setShowAdjustmentSidebar,
  formatAmount,
  formatNumber,
}: StockAdjustmentFormProps) {
  const { fields: adjustmentFields, append: appendAdjustment, remove: removeAdjustment } = useFieldArray({
    control: stockAdjustmentForm.control,
    name: "entries",
  });

  const adjustmentEntries = stockAdjustmentForm.watch("entries") || [];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center gap-2 mb-5">
            <span className="text-sm font-semibold">Production / Consumption Voucher</span>
          </div>
          <Form {...stockAdjustmentForm}>
            <form noValidate onSubmit={stockAdjustmentForm.handleSubmit(onSubmit)} className="space-y-6">
              <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                <FormField
                  control={stockAdjustmentForm.control}
                  name="locationId"
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormLabel>Location</FormLabel>
                      <Select
                        value={field.value > 0 ? field.value.toString() : ""}
                        onValueChange={(value) => field.onChange(parseInt(value))}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-adjustment-location">
                            <SelectValue placeholder="Select location..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {[...locations]
                            .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                            .map((location) => (
                              <SelectItem key={location.id} value={location.id.toString()}>
                                {location.name}
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
                            field.onChange(
                              e.target.value ? new Date(e.target.value + "T00:00:00") : new Date()
                            )
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

              {/* Entries Table Container */}
              <div className="flex flex-col lg:flex-row gap-4">
                <Card className="flex-1 overflow-hidden min-w-0">
                  {/* ... entries content ... */}
                </Card>
              </div>

              {/* Actions Footer */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t">
                {/* ... footer buttons ... */}
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
