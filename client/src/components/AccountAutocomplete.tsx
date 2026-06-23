import { forwardRef, useImperativeHandle, useState, useRef, useMemo, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type CombinedAccount = {
  type: "ledger" | "bank" | "supplier" | "employee" | "fixedAsset" | "customer" | "factorySupplier";
  id: number;
  name: string;
  code: string;
  openingBalance?: string;
  balance?: string;
};

export interface AccountAutocompleteProps {
  value: { type: string; id: number; name: string } | null;
  onChange: (
    type: "ledger" | "bank" | "supplier" | "employee" | "fixedAsset" | "customer" | "factorySupplier",
    id: number,
    name: string
  ) => void;
  allAccounts: CombinedAccount[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onSelectionCommitted?: (account: CombinedAccount) => void;
  onEnterWithoutSelection?: () => void;
  onTabPressed?: () => void;
  onArrowUp?: () => void;
  onArrowDown?: () => void;
  onArrowLeft?: () => void;
  onArrowRight?: () => void;
  testId?: string;
  rowIndex?: number;
  dropdownPosition?: "below" | "right";
  onSearchChange?: (term: string) => void;
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
      onArrowUp,
      onArrowDown,
      onArrowLeft,
      onArrowRight,
      testId,
      rowIndex = 0,
      dropdownPosition = "below",
      onSearchChange,
    },
    ref
  ) => {
    const [open, setOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState<string | null>(null);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Expose focus and clear methods
    useImperativeHandle(ref, () => ({
      focus: () => {
        inputRef.current?.focus();
      },
      clear: () => {
        setSearchTerm(null);
      },
    }));

    // Filter accounts based on search term (search both name and code/barcode)
    const filteredAccounts = useMemo(() => {
      const term = (searchTerm ?? "").toLowerCase();

      return allAccounts.filter(
        (acc) => (acc?.name ?? "").toLowerCase().includes(term) || (acc?.code ?? "").toLowerCase().includes(term)
      );
    }, [allAccounts, searchTerm]);

    // Reset highlighted index when filtered list changes
    useEffect(() => {
      setHighlightedIndex(0);
    }, [filteredAccounts.length]);

    // Scroll highlighted item into view
    useEffect(() => {
      if (listRef.current && open && filteredAccounts.length > 0) {
        const highlightedButton = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`) as HTMLElement;
        if (highlightedButton) {
          highlightedButton.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }
    }, [highlightedIndex, open, filteredAccounts.length]);

    const handleSelectAccount = (account: CombinedAccount) => {
      onChange(account.type, account.id, account.name);
      setSearchTerm(null);
      setOpen(false);
      onSelectionCommitted?.(account);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (open && filteredAccounts.length > 0 && highlightedIndex >= 0) {
          handleSelectAccount(filteredAccounts[highlightedIndex]);
        } else if (!searchTerm && !value) {
          onEnterWithoutSelection?.();
        }
      } else if (e.key === "Tab") {
        setOpen(false);
        if (onTabPressed && !e.shiftKey) {
          e.preventDefault();
          onTabPressed();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        setSearchTerm(null);
      } else if (e.key === "ArrowUp") {
        if (open && filteredAccounts.length > 0) {
          // When dropdown is open, navigate within the list
          e.preventDefault();
          setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredAccounts.length - 1));
        } else {
          // When dropdown is closed, navigate between fields
          e.preventDefault();
          onArrowUp?.();
        }
      } else if (e.key === "ArrowDown") {
        if (open && filteredAccounts.length > 0) {
          // When dropdown is open, navigate within the list
          e.preventDefault();
          setHighlightedIndex((prev) => (prev < filteredAccounts.length - 1 ? prev + 1 : 0));
        } else {
          // When dropdown is closed, navigate between fields
          e.preventDefault();
          onArrowDown?.();
        }
      } else if (e.key === "ArrowLeft") {
        // Only navigate between fields when dropdown is closed
        if (!open) {
          e.preventDefault();
          onArrowLeft?.();
        }
      } else if (e.key === "ArrowRight") {
        // Only navigate between fields when dropdown is closed
        if (!open) {
          e.preventDefault();
          onArrowRight?.();
        }
      }
    };

    // Show searchTerm if user has started editing (not null), otherwise show selected value
    const displayValue = searchTerm !== null ? searchTerm : value?.name || "";

    // Unique IDs for accessibility
    const listboxId = `account-listbox-${rowIndex}`;
    const activeOptionId = `account-option-${rowIndex}-${highlightedIndex}`;

    return (
      <div className="relative">
        <Input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && filteredAccounts.length > 0 ? activeOptionId : undefined}
          value={displayValue}
          onChange={(e) => {
            const newValue = e.target.value;
            setSearchTerm(newValue);
            onSearchChange?.(newValue);
            if (!open) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            // Open dropdown to show all accounts for browsing
            setOpen(true);
          }}
          onBlur={() => {
            // Delay to allow click on dropdown
            setTimeout(() => {
              setOpen(false);
              setSearchTerm(null);
            }, 200);
          }}
          placeholder={placeholder}
          disabled={disabled}
          className={cn("w-full", className)}
          data-testid={testId || `input-account-${rowIndex}`}
        />
        {open && filteredAccounts.length > 0 && (
          <div
            ref={listRef}
            id={listboxId}
            className={cn(
              "absolute z-50 bg-popover text-popover-foreground border rounded-md shadow-md max-h-60 overflow-y-auto",
              dropdownPosition === "right" ? "left-full ml-1 top-0 w-64" : "w-full mt-1"
            )}
            role="listbox"
          >
            {filteredAccounts.map((account, idx) => (
              <button
                key={`${account.type}-${account.id}`}
                id={`account-option-${rowIndex}-${idx}`}
                type="button"
                onClick={() => handleSelectAccount(account)}
                role="option"
                aria-selected={value?.type === account.type && value?.id === account.id}
                data-index={idx}
                className={cn(
                  "w-full text-left px-3 py-2 flex items-center gap-2 hover-elevate active-elevate-2",
                  idx === highlightedIndex && "bg-accent"
                )}
                data-testid={`account-option-${idx}`}
              >
                <Check
                  className={cn(
                    "h-4 w-4 flex-shrink-0",
                    value?.type === account.type && value?.id === account.id ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="flex-1">{account.name}</span>
                {account.balance !== undefined && (
                  <span className="text-sm text-muted-foreground font-mono">
                    $
                    {parseFloat(account.balance || "0").toLocaleString(undefined, {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
);

AccountAutocomplete.displayName = "AccountAutocomplete";
