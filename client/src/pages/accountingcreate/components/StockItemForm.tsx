/**
 * StockItemForm — extracted sub-component.
 *
 * Extracted from AccountingCreate.tsx during the Phase 4 god-file split.
 */
import { useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery } from "@tanstack/react-query";
import { formatNumber } from "@/lib/formatNumber";

import { FormButtons } from "./FormButtons";
import { useErpText } from "@/i18n/modules/erp";

export // Stock Item Form Component
function StockItemForm({
  form,
  onSubmit,
  onCancel,
  isPending,
}: {
  form: any;
  onSubmit: (data: any, saveAndNew?: boolean) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const tUi = useErpText();
  const { data: stockGroups = [] } = useQuery<any[]>({
    queryKey: ["/api/stock-groups"],
  });

  const openingQty = form.watch("openingQty");
  const openingRate = form.watch("openingRate");

  // Auto-calculate opening value
  useEffect(() => {
    if (openingQty && openingRate) {
      const value = formatNumber(parseFloat(openingQty) * parseFloat(openingRate));
      form.setValue("openingValue", value);
    }
  }, [openingQty, openingRate]);

  return (
    <Card className="p-4 md:p-6">
      <Form {...form}>
        <form noValidate onSubmit={form.handleSubmit((data: any) => onSubmit(data, false))} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tUi("code.2")}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={tUi("item001")} data-testid="input-code" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tUi("name.2")}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={tUi("premium.cotton.bale")} data-testid="input-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="stockGroupId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tUi("stock.group")}</FormLabel>
                  <Select
                    onValueChange={(v) => field.onChange(v ? parseInt(v) : undefined)}
                    value={field.value?.toString() || ""}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-stock-group">
                        <SelectValue placeholder={tUi("none")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {stockGroups.map((grp: any) => (
                        <SelectItem key={grp.id} value={grp.id.toString()}>
                          {grp.name} ({grp.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="uom"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tUi("unit.of.measure")}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={tUi("kg.pcs.bale")} data-testid="input-uom" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="openingQty"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tUi("opening.quantity")}</FormLabel>
                  <FormControl>
                    <Input {...field} type="number" step="0.001" placeholder="0.000" data-testid="input-opening-qty" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="openingRate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tUi("opening.rate")}</FormLabel>
                  <FormControl>
                    <Input {...field} type="number" step="0.01" placeholder="0.00" data-testid="input-opening-rate" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="openingValue"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tUi("opening.value.auto")}</FormLabel>
                  <FormControl>
                    <Input {...field} readOnly className="bg-muted" data-testid="input-opening-value" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="reorderLevel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tUi("reorder.level")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      step="0.001"
                      placeholder="10.000"
                      data-testid="input-reorder-level"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sellingPrice"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tUi("selling.price")}</FormLabel>
                  <FormControl>
                    <Input {...field} type="number" step="0.01" placeholder="0.00" data-testid="input-selling-price" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 space-y-0 pt-8">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} data-testid="checkbox-active" />
                  </FormControl>
                  <FormLabel className="!mt-0">{tUi("active")}</FormLabel>
                </FormItem>
              )}
            />
          </div>

          <FormButtons onCancel={onCancel} isPending={isPending} />
        </form>
      </Form>
    </Card>
  );
}

// Reusable Form Buttons Component
