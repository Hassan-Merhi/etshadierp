import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Types
export interface BankAccount {
  id: number;
  accountNumber: string;
  bankName: string;
  accountName: string;
  balance: string;
}

export interface LedgerAccount {
  id: number;
  code: string;
  name: string;
  accountType: string;
}

export interface Supplier {
  id: number;
  code: string;
  legalName: string;
}

export interface StockItem {
  id: number;
  code: string;
  name: string;
  uom: string;
}

export interface Location {
  id: number;
  code: string;
  name: string;
}

export interface VoucherEntry {
  id: number;
  ledgerAccountId: number | null;
  bankAccountId: number | null;
  supplierId: number | null;
  factorySupplierId?: number | null;
  employeeId?: number | null;
  debitAmount: string;
  creditAmount: string;
  narration: string | null;
}

export interface PurchaseOrderLineItem {
  id: number;
  stockItemId: number;
  itemName: string;
  quantity: string;
  rate: string;
  lineTotal: string;
}

export interface PurchaseOrderData {
  id: number;
  companyId: number;
  poNumber: string;
  containerId: number;
  supplierId: number;
  voucherId: number | null;
  currency: string;
  itemsTotal: string;
  status: string;
  items: PurchaseOrderLineItem[];
}

export interface SalesItem {
  id: number;
  voucherId: number;
  stockItemId: number;
  quantity: string;
  sellingPrice: string;
  costPrice: string;
  totalSales: string;
  totalCost: string;
  profit: string;
  stockItemCode: string;
  stockItemName: string;
  stockItemUom: string;
}

export interface AdjustmentItem {
  id: number;
  adjustmentId: number;
  stockItemId: number;
  quantity: string;
  rate: string;
  totalAmount: string;
  stockItemCode: string;
  stockItemName: string;
  stockItemUom: string;
}

export interface AdjustmentData {
  id: number;
  voucherId: number;
  locationId: number;
  adjustmentType: string;
  notes: string | null;
  locationName: string;
  items: AdjustmentItem[];
}

export interface TransferItem {
  id: number;
  transferId: number;
  stockItemId: number;
  quantity: string;
  rate: string;
  totalAmount: string;
  stockItemCode: string;
  stockItemName: string;
  stockItemUom: string;
}

export interface TransferData {
  id: number;
  voucherId: number;
  sourceLocationId: number;
  destinationLocationId: number;
  notes: string | null;
  sourceLocationName: string;
  destinationLocationName: string;
  items: TransferItem[];
}

export interface VoucherData {
  id: number;
  companyId: number;
  locationId: number | null;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  description: string | null;
  totalAmount: string;
  optional: boolean;
  currency?: string | null;
  entries: VoucherEntry[];
  purchaseOrder?: PurchaseOrderData | null;
  salesItems?: SalesItem[] | null;
  adjustmentData?: AdjustmentData | null;
  transferData?: TransferData | null;
}

// Stock Item Combobox Component
export function StockItemCombobox({
  value,
  onChange,
  stockItems,
  rowIndex,
  testIdPrefix = "button-stock-item",
}: {
  value: { id: number; name: string } | null;
  onChange: (id: number, name: string) => void;
  stockItems: StockItem[];
  rowIndex: number;
  testIdPrefix?: string;
}) {
  const [open, setOpen] = useState(false);

  const sortedStockItems = [...stockItems].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          data-testid={`${testIdPrefix}-${rowIndex}`}
        >
          {value ? value.name : "Select item..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[calc(100vw-2rem)] sm:w-[400px] p-0 bg-popover text-popover-foreground">
        <Command className="bg-popover text-popover-foreground">
          <CommandInput placeholder="Search stock items..." className="bg-popover text-popover-foreground" />
          <CommandList className="bg-popover text-popover-foreground">
            <CommandEmpty>No stock item found.</CommandEmpty>
            <CommandGroup>
              {sortedStockItems.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.name}
                  onSelect={() => {
                    onChange(item.id, item.name);
                    setOpen(false);
                  }}
                  data-testid={`option-stock-item-${item.id}`}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value?.id === item.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {item.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Account Combobox Component
export function AccountCombobox({
  value,
  onChange,
  ledgerAccounts,
  bankAccounts,
  suppliers,
  rowIndex,
  testIdPrefix = "button-account",
}: {
  value: { type: string; id: number; name: string } | null;
  onChange: (type: "ledger" | "bank" | "supplier" | "factorySupplier", id: number, name: string) => void;
  ledgerAccounts: LedgerAccount[];
  bankAccounts: BankAccount[];
  suppliers: Supplier[];
  rowIndex: number;
  testIdPrefix?: string;
}) {
  const [open, setOpen] = useState(false);

  const allAccounts = [
    ...ledgerAccounts.map((a) => ({
      type: "ledger" as const,
      id: a.id,
      name: a.name,
    })),
    ...bankAccounts.map((a) => ({
      type: "bank" as const,
      id: a.id,
      name: a.bankName,
    })),
    ...suppliers.map((s) => ({
      type: "supplier" as const,
      id: s.id,
      name: s.legalName,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          data-testid={`${testIdPrefix}-${rowIndex}`}
        >
          {value ? value.name : "Select account..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[calc(100vw-2rem)] sm:w-[400px] p-0 bg-popover text-popover-foreground">
        <Command className="bg-popover text-popover-foreground">
          <CommandInput placeholder="Search accounts..." className="bg-popover text-popover-foreground" />
          <CommandList className="bg-popover text-popover-foreground">
            <CommandEmpty>No account found.</CommandEmpty>
            <CommandGroup>
              {allAccounts.map((account) => (
                <CommandItem
                  key={`${account.type}-${account.id}`}
                  value={account.name}
                  onSelect={() => {
                    onChange(account.type, account.id, account.name);
                    setOpen(false);
                  }}
                  data-testid={`option-account-${account.type}-${account.id}`}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value?.type === account.type && value?.id === account.id
                        ? "opacity-100"
                        : "opacity-0"
                    )}
                  />
                  {account.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function focusByTestId(testId: string, selectAll = false) {
  setTimeout(() => {
    const el = document.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement;
    if (el) {
      el.focus();
      if (selectAll && el.select) el.select();
    }
  }, 0);
}
