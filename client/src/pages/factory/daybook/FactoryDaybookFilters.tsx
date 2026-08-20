/**
 * Filter bar for the Factory Daybook transactions tab.
 *
 * Pure presentation over the page model: same controls, same test ids, same
 * transaction-type option list and ordering as the inline markup it replaces.
 */
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PeriodFilter } from "@/components/ui/period-filter";
import type { FactoryDaybookModel } from "./useFactoryDaybookModel";

const TX_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "ALL", label: "All Types" },
  { value: "PAYMENT", label: "Payment" },
  { value: "RECEIPT", label: "Receipt" },
  { value: "JOURNAL", label: "Journal" },
  { value: "INVOICE", label: "Invoice" },
  { value: "BALE_TRANSFER", label: "Bale Transfer" },
  { value: "CONTAINER_IMPORT", label: "Container Import" },
  { value: "OFFLOAD_RAW_STOCK", label: "Offload Raw Stock" },
  { value: "COMMISSION", label: "Commission" },
  { value: "BALE_PRESSING", label: "Bale Pressing" },
  { value: "BALE_FINALIZE", label: "Bale Finalize" },
  { value: "BALE_STOCK_ENTRY", label: "Bale Stock Entry" },
  { value: "BALE_REMOVAL", label: "Bale Removal" },
  { value: "FREIGHT_PAYMENT", label: "Freight Payment" },
  { value: "SUPPLIER_PAYMENT", label: "Supplier Payment" },
  { value: "PAYROLL_PAYMENT", label: "Payroll Payment" },
  { value: "DOC_UPLOAD", label: "Doc Upload" },
  { value: "DOC_DELETE", label: "Doc Delete" },
  { value: "FREIGHT_ADD", label: "Freight Add" },
];

export function FactoryDaybookFilters({ model }: { model: FactoryDaybookModel }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder="Search..."
            value={model.searchQuery}
            onChange={(e) => model.setSearchQuery(e.target.value)}
            data-testid="input-search"
            className="w-44 h-8 text-sm"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => model.stepPeriod(-1)}
            title="Previous day (−)"
            data-testid="button-prev-day"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <PeriodFilter value={model.periodFilter} onChange={model.setPeriodFilter} data-testid="period-filter" />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => model.stepPeriod(1)}
            title="Next day (+)"
            data-testid="button-next-day"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Select value={model.txTypeFilter} onValueChange={model.setTxTypeFilter}>
            <SelectTrigger className="w-36 h-8 text-sm" data-testid="select-tx-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TX_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={model.statusFilter}
            onValueChange={(v) => model.setStatusFilter(v as "all" | "exclude" | "only")}
          >
            <SelectTrigger className="w-36 h-8 text-sm" data-testid="select-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Entries</SelectItem>
              <SelectItem value="exclude">Exclude Optional</SelectItem>
              <SelectItem value="only">Only Optional</SelectItem>
            </SelectContent>
          </Select>
          {model.hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={model.clearFilters}
              data-testid="button-clear-filters"
              className="gap-1 h-8 text-sm"
            >
              <X className="w-3.5 h-3.5" />
              Clear
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
