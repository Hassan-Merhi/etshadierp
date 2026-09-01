import { usePaginatedFilterState, type FilterStateAction } from "@/hooks/use-paginated-filter-state";
import { createDaybookFilters, type DaybookFiltersState } from "./filterState";

export function useDaybookFilterState(companyId: number | undefined) {
  const state = usePaginatedFilterState<DaybookFiltersState>({
    createInitialFilters: createDaybookFilters,
    storageKey: `erp-daybook-filters-v1:${companyId ?? "none"}`,
  });

  return {
    periodFilter: state.filters.periodFilter,
    filters: state.filters.filters,
    voucherPage: state.page,
    setVoucherPage: state.setPage,
    setPeriodFilter: (next: FilterStateAction<DaybookFiltersState["periodFilter"]>) =>
      state.setFilter("periodFilter", next),
    setFilters: (next: FilterStateAction<DaybookFiltersState["filters"]>) => state.setFilter("filters", next),
    resetFilters: state.resetFilters,
    hasActiveFilters: state.hasActiveFilters,
  };
}
