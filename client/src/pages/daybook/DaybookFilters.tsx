import { Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PeriodFilter, PeriodFilterValue, getDefaultPeriodValue } from "@/components/ui/period-filter";

interface DaybookFiltersProps {
  periodFilter: PeriodFilterValue;
  setPeriodFilter: (v: PeriodFilterValue) => void;
  filters: {
    voucherType: string;
    searchQuery: string;
    statusFilter: "all" | "active" | "optional";
    minAmount: string;
    maxAmount: string;
  };
  setFilters: (v: any) => void;
  onPrevDay?: () => void;
  onNextDay?: () => void;
}

export function DaybookFilters({
  periodFilter,
  setPeriodFilter,
  filters,
  setFilters,
}: DaybookFiltersProps) {
  const hasActiveFilters =
    filters.voucherType !== "all" ||
    !!filters.searchQuery ||
    !!filters.minAmount ||
    !!filters.maxAmount ||
    filters.statusFilter !== "all";

  return (
    <div className="flex flex-col gap-2">
      {/* Single row: date | types | status | search */}
      <div className="flex flex-wrap items-center gap-2">
        <PeriodFilter
          value={periodFilter}
          onChange={setPeriodFilter}
          hideCustomInputs
          data-testid="period-filter"
        />

        <Select value={filters.voucherType} onValueChange={(value) => setFilters({ ...filters, voucherType: value })}>
          <SelectTrigger
            id="voucher-type"
            data-testid="select-voucher-type"
            className="w-[130px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="Sales">Sales</SelectItem>
            <SelectItem value="Purchase">Purchase</SelectItem>
            <SelectItem value="Payment">Payment</SelectItem>
            <SelectItem value="Receipt">Receipt</SelectItem>
            <SelectItem value="Journal">Journal</SelectItem>
            <SelectItem value="Contra">Contra</SelectItem>
            <SelectItem value="Offload">Offload</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.statusFilter}
          onValueChange={(value) => setFilters({ ...filters, statusFilter: value as "all" | "active" | "optional" })}
        >
          <SelectTrigger
            id="status-filter"
            data-testid="select-status-filter"
            className="w-[130px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active Only</SelectItem>
            <SelectItem value="optional">Optional Only</SelectItem>
          </SelectContent>
        </Select>

        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            id="search"
            placeholder="Voucher # or description..."
            value={filters.searchQuery}
            onChange={(e) => setFilters({ ...filters, searchQuery: e.target.value })}
            data-testid="input-search"
            className="pl-9"
          />
        </div>
      </div>

      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Active:</span>
          {filters.voucherType !== "all" && (
            <Badge
              variant="secondary"
              className="gap-1 cursor-pointer text-xs"
              onClick={() => setFilters({ ...filters, voucherType: "all" })}
              data-testid="chip-type"
            >
              {filters.voucherType}
              <X className="h-3 w-3" />
            </Badge>
          )}
          {filters.statusFilter !== "all" && (
            <Badge
              variant="secondary"
              className="gap-1 cursor-pointer text-xs"
              onClick={() => setFilters({ ...filters, statusFilter: "all" })}
              data-testid="chip-status"
            >
              {filters.statusFilter === "active" ? "Active Only" : "Optional Only"}
              <X className="h-3 w-3" />
            </Badge>
          )}
          {filters.minAmount && (
            <Badge
              variant="secondary"
              className="gap-1 cursor-pointer text-xs"
              onClick={() => setFilters({ ...filters, minAmount: "" })}
              data-testid="chip-min"
            >
              Min: {filters.minAmount}
              <X className="h-3 w-3" />
            </Badge>
          )}
          {filters.maxAmount && (
            <Badge
              variant="secondary"
              className="gap-1 cursor-pointer text-xs"
              onClick={() => setFilters({ ...filters, maxAmount: "" })}
              data-testid="chip-max"
            >
              Max: {filters.maxAmount}
              <X className="h-3 w-3" />
            </Badge>
          )}
          {!!filters.searchQuery && (
            <Badge
              variant="secondary"
              className="gap-1 cursor-pointer text-xs"
              onClick={() => setFilters({ ...filters, searchQuery: "" })}
              data-testid="chip-search"
            >
              Search: {filters.searchQuery}
              <X className="h-3 w-3" />
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
