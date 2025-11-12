import { UseFormReturn, UseFieldArrayReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Plus } from "lucide-react";

export interface VoucherEntry {
  accountType: "ledger" | "bank" | "supplier" | "employee" | "fixedAsset";
  accountId: number;
  accountName: string;
  amount: string;
}

interface VoucherEntriesTableProps {
  form: UseFormReturn<any>;
  fieldArray: UseFieldArrayReturn<any, "entries", "id">;
  entries: VoucherEntry[];
  total: number;
  mode: "payment" | "receipt";
  onAmountCommit?: (rowIndex: number) => void;
}

export function VoucherEntriesTable({
  form,
  fieldArray,
  entries,
  total,
  mode,
  onAmountCommit,
}: VoucherEntriesTableProps) {
  const { fields, append, remove } = fieldArray;

  const handleAddRow = () => {
    append({
      accountType: "ledger",
      accountId: 0,
      accountName: "",
      amount: "",
    });
  };

  const handleBlur = (index: number) => {
    if (!onAmountCommit) return;
    
    const amount = Number(entries[index]?.amount);
    if (!isNaN(amount) && amount > 0) {
      onAmountCommit(index);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const amount = Number(entries[index]?.amount);
      
      if (!isNaN(amount) && amount > 0) {
        // Call commit callback to clear selection and refocus search
        if (onAmountCommit) {
          onAmountCommit(index);
        }
        
        // Then add a new row
        handleAddRow();
        
        // Focus the new row's amount input
        requestAnimationFrame(() => {
          const newRowIndex = entries.length;
          const newInput = document.querySelector(`[data-testid="input-amount-${newRowIndex}"]`) as HTMLInputElement;
          if (newInput) {
            newInput.focus();
            newInput.select();
          }
        });
      }
    } else if (e.key === "ArrowUp" && index > 0) {
      e.preventDefault();
      const prevInput = document.querySelector(`[data-testid="input-amount-${index - 1}"]`) as HTMLInputElement;
      if (prevInput) {
        prevInput.focus();
        prevInput.select();
      }
    } else if (e.key === "ArrowDown" && index < entries.length - 1) {
      e.preventDefault();
      const nextInput = document.querySelector(`[data-testid="input-amount-${index + 1}"]`) as HTMLInputElement;
      if (nextInput) {
        nextInput.focus();
        nextInput.select();
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
          {fields.map((field, index) => (
            <tr key={field.id} className="border-t hover-elevate">
              <td className="p-3">
                <div className="text-sm" data-testid={`text-account-${index}`}>
                  {entries[index]?.accountName || (
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
                          onKeyDown={(e) => handleKeyDown(e, index)}
                          onBlur={() => handleBlur(index)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </td>
              <td className="p-2">
                {fields.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(index)}
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
                onClick={handleAddRow}
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
