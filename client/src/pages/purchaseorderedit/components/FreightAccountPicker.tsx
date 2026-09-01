/**
 * FreightAccountPicker — extracted sub-component.
 *
 * Extracted from PurchaseOrderEdit.tsx during the Phase 4 god-file split.
 */
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export function FreightAccountPicker({
  value,
  onValueChange,
  accounts,
}: {
  value: string;
  onValueChange: (value: string) => void;
  accounts: Array<{ id: number; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const selected = accounts.find((a) => a.id.toString() === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          data-testid="button-freight-account"
        >
          {selected ? selected.name : "Select account..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command>
          <CommandInput placeholder="Search accounts..." />
          <CommandList>
            <CommandEmpty>No account found.</CommandEmpty>
            <CommandGroup>
              {accounts.map((acct) => (
                <CommandItem
                  key={acct.id}
                  value={acct.name}
                  onSelect={() => {
                    onValueChange(acct.id.toString());
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === acct.id.toString() ? "opacity-100" : "opacity-0")} />
                  {acct.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
