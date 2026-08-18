import { Building2, Factory, Filter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PeriodFilter } from "@/components/ui/period-filter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FilterFieldSetter } from "@/hooks/use-paginated-filter-state";
import type { CompanyOption } from "../types";
import type { TransactionJournalFilters } from "../filterState";

interface TransactionJournalFilterControlsProps {
  filters: TransactionJournalFilters;
  availableCompanies: CompanyOption[];
  voucherTypes?: string[];
  setFilter: FilterFieldSetter<TransactionJournalFilters>;
  resetFilters: () => void;
  hasActiveFilters: boolean;
}

export function TransactionJournalFilterControls({
  filters,
  availableCompanies,
  voucherTypes,
  setFilter,
  resetFilters,
  hasActiveFilters,
}: TransactionJournalFilterControlsProps) {
  const { periodFilter, selectedCos, voucherType, currency, optionalFilter, includeFactory, searchInput, search } =
    filters;

  const applySearch = () => setFilter("search", searchInput);

  const chips = [
    { label: "All", value: "all" },
    { label: "Payment", value: "Payment" },
    { label: "Receipt", value: "Receipt" },
    { label: "Sales", value: "Sales" },
    { label: "Purchase", value: "Purchase" },
    { label: "Stock Transfer", value: "Stock Transfer" },
    { label: "Journal", value: "Journal" },
    { label: "Mixed", value: "Mixed" },
    { label: "Production", value: "Production" },
    { label: "Consumption", value: "Consumption" },
  ];

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              <CardTitle>Filters</CardTitle>
            </div>
            {hasActiveFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={resetFilters}
                data-testid="button-reset-filters"
              >
                <X className="h-4 w-4" />
                Reset Filters
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label>Period</Label>
              <PeriodFilter
                value={periodFilter}
                onChange={(value) => setFilter("periodFilter", value)}
                data-testid="period-filter"
              />
            </div>

            <div className="space-y-2">
              <Label>Companies</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="min-w-[160px] justify-between"
                    data-testid="button-company-filter"
                  >
                    <Building2 className="mr-2 h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate text-left">
                      {selectedCos.length === 0 ? "All Companies" : `${selectedCos.length} selected`}
                    </span>
                    <Filter className="ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel>Select Companies</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={selectedCos.length === 0}
                    onCheckedChange={() => setFilter("selectedCos", [])}
                    data-testid="checkbox-all-companies"
                  >
                    All Companies
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  {availableCompanies.map((company) => (
                    <DropdownMenuCheckboxItem
                      key={company.id}
                      checked={selectedCos.includes(company.id)}
                      onCheckedChange={(checked) =>
                        setFilter("selectedCos", (current) =>
                          checked ? [...current, company.id] : current.filter((id) => id !== company.id)
                        )
                      }
                      data-testid={`checkbox-company-${company.id}`}
                    >
                      {company.name}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="space-y-2">
              <Label htmlFor="voucher-type-tj">Voucher Type</Label>
              <Select value={voucherType} onValueChange={(value) => setFilter("voucherType", value)}>
                <SelectTrigger id="voucher-type-tj" className="w-[150px]" data-testid="select-voucher-type">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {(voucherTypes || []).map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="currency-tj">Currency</Label>
              <Select value={currency} onValueChange={(value) => setFilter("currency", value)}>
                <SelectTrigger id="currency-tj" className="w-[110px]" data-testid="select-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="CFA">CFA</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status-tj">Status</Label>
              <Select value={optionalFilter} onValueChange={(value) => setFilter("optionalFilter", value)}>
                <SelectTrigger id="status-tj" className="w-[130px]" data-testid="select-optional">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="active">Active Only</SelectItem>
                  <SelectItem value="optional">Optional Only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Factory</Label>
              <div>
                <Button
                  variant={includeFactory ? "default" : "outline"}
                  className="gap-2"
                  onClick={() => setFilter("includeFactory", (current) => !current)}
                  data-testid="button-toggle-factory"
                >
                  <Factory className="h-4 w-4" />
                  {includeFactory ? "Included" : "Excluded"}
                </Button>
              </div>
            </div>

            <div className="w-full min-w-0 flex-1 space-y-2 md:w-auto md:min-w-[200px]">
              <Label htmlFor="search-tj">Search</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="search-tj"
                    value={searchInput}
                    onChange={(event) => setFilter("searchInput", event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && applySearch()}
                    placeholder="Voucher # or narration…"
                    className="pl-8"
                    data-testid="input-search"
                  />
                </div>
                <Button variant="default" className="shrink-0" onClick={applySearch} data-testid="button-search">
                  Search
                </Button>
                {search && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setFilter("searchInput", "");
                      setFilter("search", "");
                    }}
                    data-testid="button-clear-search"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-1.5" data-testid="type-chips">
        {chips.map((chip) => {
          const active = voucherType === chip.value || (chip.value === "all" && voucherType === "all");
          return (
            <button
              key={chip.value}
              onClick={() => setFilter("voucherType", chip.value)}
              data-testid={`chip-type-${chip.value.replace(/\s+/g, "-").toLowerCase()}`}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-foreground/40 hover:text-foreground"
              }`}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
    </>
  );
}
