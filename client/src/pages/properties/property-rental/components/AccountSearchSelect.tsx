/**
 * AccountSearchSelect — extracted sub-component.
 *
 * Extracted from PropertyRentalPage.tsx during the Phase 4 god-file split.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import type { CashAccount } from "../types";

export // ──────────────────────────────────────────────────────────
// REUSABLE: ACCOUNT SEARCH SELECT
// ──────────────────────────────────────────────────────────
function AccountSearchSelect({
  accounts,
  value,
  onChange,
  placeholder,
  testId,
}: {
  accounts: CashAccount[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = accounts.find((a) => String(a.id) === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-between font-normal" data-testid={testId}>
          {selected ? (
            <span className="truncate">
              {selected.name} <span className="text-xs text-muted-foreground">({selected.accountType})</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder ?? "Select account…"}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search accounts…" />
          <CommandList>
            <CommandEmpty>No accounts found.</CommandEmpty>
            {accounts.map((a) => (
              <CommandItem
                key={a.id}
                value={`${a.name} ${a.accountType}`}
                onSelect={() => {
                  onChange(String(a.id));
                  setOpen(false);
                }}
              >
                <span className="flex-1 truncate">{a.name}</span>
                <span className="text-xs text-muted-foreground ml-2">{a.accountType}</span>
                {String(a.id) === value && <Check className="ml-2 h-4 w-4 shrink-0" />}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ──────────────────────────────────────────────────────────
// BULK PAYMENT DIALOG
// ──────────────────────────────────────────────────────────
