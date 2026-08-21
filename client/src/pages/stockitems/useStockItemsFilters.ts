import { useEffect, useState } from "react";
import { usePaginatedFilterState, type FilterStateAction } from "@/hooks/use-paginated-filter-state";

interface StockItemsFilters extends Record<string, unknown> {
  searchTerm: string;
  selectedGroupFilter: number | null;
  selectedGradeFilter: number | null;
  selectedCategoryFilter: number | "none" | null;
}

export function useStockItemsFilters(companyId: number | undefined) {
  const state = usePaginatedFilterState<StockItemsFilters>({
    createInitialFilters: () => ({
      searchTerm: "",
      selectedGroupFilter: null,
      selectedGradeFilter: null,
      selectedCategoryFilter: null,
    }),
    storageKey: companyId ? `erp-stock-items-filters-v1:${companyId}` : undefined,
  });
  const { searchTerm, selectedGroupFilter, selectedGradeFilter, selectedCategoryFilter } = state.filters;
  const { setPage } = state;
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm, setPage]);

  useEffect(() => {
    setPage(1);
  }, [selectedGroupFilter, selectedGradeFilter, selectedCategoryFilter, setPage]);

  return {
    ...state,
    debouncedSearch,
    setSearchTerm: (next: FilterStateAction<string>) => state.setFilter("searchTerm", next),
    setSelectedGroupFilter: (next: FilterStateAction<number | null>) => state.setFilter("selectedGroupFilter", next),
    setSelectedGradeFilter: (next: FilterStateAction<number | null>) => state.setFilter("selectedGradeFilter", next),
    setSelectedCategoryFilter: (next: FilterStateAction<number | "none" | null>) =>
      state.setFilter("selectedCategoryFilter", next),
  };
}
