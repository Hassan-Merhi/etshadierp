import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { InventoryTable } from "./InventoryTable";
import { PaginationBar } from "@/components/PaginationBar";
import type { InventoryItem } from "./locationInventoryTypes";

interface AllItemsViewProps {
  totalItems: number;
  totalQty: number;
  totalValue: number;
  posUser?: any;
  formatAmount: (v: number) => string;
  itemSearchTerm: string;
  setItemSearchTerm: (v: string) => void;
  allItemsFiltered: InventoryItem[];
  showMovement: boolean;
  openingInventoryMap: Map<number, number>;
  selectedRowIndex: number;
  setSelectedRowIndex: (v: number) => void;
  navigate: (path: string) => void;
  inventory: InventoryItem[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    onPageChange: (page: number) => void;
  };
}

export function AllItemsView({
  totalItems,
  totalQty,
  totalValue,
  posUser,
  formatAmount,
  itemSearchTerm,
  setItemSearchTerm,
  allItemsFiltered,
  showMovement,
  openingInventoryMap,
  selectedRowIndex,
  setSelectedRowIndex,
  navigate,
  inventory,
  pagination,
}: AllItemsViewProps) {
  return (
    <>
      {/* Stats */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
        <span className="font-semibold text-foreground">{totalItems}</span> Items
        <span className="text-muted-foreground">·</span>
        <span className="font-semibold text-foreground font-mono">{Math.floor(totalQty).toLocaleString()}</span> BL
        total
        {!posUser && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="font-semibold text-foreground">{formatAmount(totalValue)}</span> total value
          </>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search items by name..."
          value={itemSearchTerm}
          onChange={(e) => setItemSearchTerm(e.target.value)}
          className="pl-9"
          data-testid="input-all-item-search"
        />
      </div>

      <InventoryTable
        filteredStockItems={allItemsFiltered}
        showMovement={showMovement}
        openingInventoryMap={openingInventoryMap}
        selectedRowIndex={selectedRowIndex}
        setSelectedRowIndex={setSelectedRowIndex}
        navigate={navigate}
        formatAmount={formatAmount}
        posUser={posUser}
        itemSearchTerm={itemSearchTerm}
        inventory={inventory}
        selectedGroup={null}
      />
      {pagination && (
        <PaginationBar
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={pagination.onPageChange}
        />
      )}
    </>
  );
}
