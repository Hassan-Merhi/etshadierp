import { forwardRef, useImperativeHandle, useState, useRef, useMemo, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type CombinedAccount = {
  type: "ledger" | "bank" | "supplier";
  id: number;
  name: string;
  code: string;
};

export interface AccountAutocompleteProps {
  value: { type: string; id: number; name: string } | null;
  onChange: (type: "ledger" | "bank" | "supplier", id: number, name: string) => void;
  allAccounts: CombinedAccount[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onSelectionCommitted?: (account: CombinedAccount) => void;
  onEnterWithoutSelection?: () => void;
  onTabPressed?: () => void;
  testId?: string;
  rowIndex?: number;
}

export interface AccountAutocompleteHandle {
  focus: () => void;
  clear: () => void;
}

export const AccountAutocomplete = forwardRef<AccountAutocompleteHandle, AccountAutocompleteProps>(
  (
    {
      value,
      onChange,
      allAccounts,
      placeholder = "Select account...",
      disabled = false,
      className,
      onSelectionCommitted,
      onEnterWithoutSelection,
      onTabPressed,
      testId,
      rowIndex = 0,
    },
    ref
  ) => {
    const [open, setOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Expose focus and clear methods
    useImperativeHandle(ref, () => ({
      focus: () => {
        inputRef.current?.focus();
      },
      clear: () => {
        setSearchTerm("");
      },
    }));

    // Filter accounts based on search term (search both name and code/barcode)
    const filteredAccounts = useMemo(() => {
      if (!searchTerm) return allAccounts;
      const term = searchTerm.toLowerCase();
      return allAccounts.filter((acc) =>
        acc.name.toLowerCase().includes(term) ||
        acc.code.toLowerCase().includes(term)
      );
    }, [allAccounts, searchTerm]);

    // Reset highlighted index when filtered list changes
    useEffect(() => {
      setHighlightedIndex(0);
    }, [filteredAccounts.length]);

    // Scroll highlighted item into view
    useEffect(() => {
      if (listRef.current && open) {
        const items = listRef.current.querySelectorAll('[role="option"]');
        const highlightedElement = items[highlightedIndex] as HTMLElement;
        if (highlightedElement) {
          highlightedElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }
    }, [highlightedIndex, open]);

    const handleSelectAccount = (account: CombinedAccount) => {
      onChange(account.type, account.id, account.name);
      setSearchTerm("");
      setOpen(false);
      onSelectionCommitted?.(account);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (!open && filteredAccounts.length > 0 && searchTerm) {
        setOpen(true);
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (open && filteredAccounts.length > 0) {
          setHighlightedIndex((prev) =>
            Math.min(prev + 1, filteredAccounts.length - 1)
          );
        } else if (!open && filteredAccounts.length > 0) {
          setOpen(true);
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (open && highlightedIndex > 0) {
          setHighlightedIndex((prev) => Math.max(prev - 1, 0));
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (open && filteredAccounts.length > 0 && highlightedIndex >= 0) {
          handleSelectAccount(filteredAccounts[highlightedIndex]);
        } else if (!searchTerm && !value) {
          // Empty field, Enter pressed - allow form to handle (e.g., add new row)
          onEnterWithoutSelection?.();
        }
      } else if (e.key === "Tab") {
        // Close dropdown and let Tab propagate
        setOpen(false);
        if (onTabPressed && !e.shiftKey) {
          e.preventDefault();
          onTabPressed();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        setSearchTerm("");
      }
    };

    // Display searchTerm when typing, otherwise show selected value
    const displayValue = searchTerm || (value ? value.name : "");

    return (
      <div className="relative">
        <Input
          ref={inputRef}
          value={displayValue}
          onChange={(e) => {
            const newValue = e.target.value;
            setSearchTerm(newValue);
            if (!open) setOpen(true);
            // Clear the selection when user starts typing
            if (newValue && value) {
              // User is editing - signal that we're no longer committed to the previous selection
              // The actual clearing happens when a new account is selected
            }
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            // When focusing, if there's a value, clear searchTerm to show the selected name
            // When user starts typing, searchTerm will take over
            setOpen(true);
          }}
          onBlur={() => {
            // Delay to allow click on dropdown
            setTimeout(() => {
              setOpen(false);
              if (!value) {
                setSearchTerm("");
              }
            }, 200);
          }}
          placeholder={placeholder}
          disabled={disabled}
          className={cn("w-full", className)}
          data-testid={testId || `input-account-${rowIndex}`}
        />
        {open && filteredAccounts.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-popover text-popover-foreground border rounded-md shadow-md max-h-60 overflow-y-auto">
            <Command shouldFilter={false} onKeyDown={(e) => e.stopPropagation()}>
              <CommandList ref={listRef}>
                <CommandEmpty>No accounts found.</CommandEmpty>
                <CommandGroup>
                  {filteredAccounts.map((account, idx) => (
                    <CommandItem
                      key={`${account.type}-${account.id}`}
                      value={account.name}
                      onSelect={() => handleSelectAccount(account)}
                      className={cn(
                        "cursor-pointer",
                        idx === highlightedIndex && "bg-accent"
                      )}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value?.type === account.type && value?.id === account.id
                            ? "opacity-100"
                            : "opacity-0"
                        )}
                      />
                      <div className="flex-1">
                        {account.name}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>
        )}
      </div>
    );
  }
);

AccountAutocomplete.displayName = "AccountAutocomplete";
