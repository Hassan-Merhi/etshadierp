/**
 * StockGroupForm — extracted sub-component.
 *
 * Extracted from AccountingCreate.tsx during the Phase 4 god-file split.
 */
import { Card } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { FormButtons } from "./FormButtons";
import { useErpText } from "@/i18n/modules/erp";

export // Stock Group Form Component
function StockGroupForm({
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
                    <Input {...field} placeholder={tUi("grp001")} data-testid="input-code" />
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
                    <Input {...field} placeholder={tUi("cotton.bales")} data-testid="input-name" />
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

// Stock Item Form Component
