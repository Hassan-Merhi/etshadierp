import { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Plus } from "lucide-react";
import { VoucherEntry } from "@/hooks/useVoucherEntries";

interface VoucherEntriesTableProps {
  form: UseFormReturn<any>;
  entries: VoucherEntry[];
  total: number;
  amountInputRefs: React.MutableRefObject<(HTMLInputElement | null)[]>;
  onRemoveEntry: (index: number) => void;
  onAddRow: () => void;
  mode: "payment" | "receipt";
}

export function VoucherEntriesTable({
  form,
  entries,
  total,
  amountInputRefs,
  onRemoveEntry,
  onAddRow,
  mode,
}: VoucherEntriesTableProps) {
  const handleKeyDown = (e: React.KeyboardEvent, index: number, field: "account" | "amount") => {
    if (e.key === "Enter") {
      e.preventDefault();
      
      if (field === "amount") {
        const amount = parseFloat(entries[index].amount);
        if (!isNaN(amount) && amount > 0) {
          onAddRow();
        }
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (index > 0) {
        const prevInput = amountInputRefs.current[index - 1];
        if (prevInput) {
          prevInput.focus();
          prevInput.select();
        }
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (index < entries.length - 1) {
        const nextInput = amountInputRefs.current[index + 1];
        if (nextInput) {
          nextInput.focus();
          nextInput.select();
        }
      }
    }
  };

  return (
    <div className="border rounded-md overflow-hidden">
      <table className="w-full">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left p-3 font-medium w-[60%]">Account</th>
            <th className="text-left p-3 font-medium w-[35%]">Amount</th>
            <th className="w-[5%]"></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => (
            <tr key={index} className="border-t hover-elevate">
              <td className="p-3">
                <div className="text-sm" data-testid={`text-account-${index}`}>
                  {entry.accountName || (
                    <span className="text-muted-foreground italic">
                      Click an account in the sidebar →
                    </span>
                  )}
                </div>
              </td>
              <td className="p-2">
                <FormField
                  control={form.control}
                  name={`entries.${index}.amount`}
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          className="font-mono"
                          data-testid={`input-amount-${index}`}
                          onKeyDown={(e) => handleKeyDown(e, index, "amount")}
                          ref={(el) => {
                            amountInputRefs.current[index] = el;
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </td>
              <td className="p-2">
                {entries.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemoveEntry(index)}
                    data-testid={`button-remove-${index}`}
                  >
                    ×
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-muted/30 border-t-2">
          <tr>
            <td colSpan={1} className="p-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onAddRow}
                data-testid="button-add-row"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Row
              </Button>
            </td>
            <td className="p-3">
              <div className="text-right font-bold font-mono">
                ${total.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
            </td>
            <td colSpan={1}></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
